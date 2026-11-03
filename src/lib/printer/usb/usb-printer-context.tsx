"use client";
/**
 * ============================================================================
 *  КОНТЕКСТ USB-ПЕЧАТИ (POS-принтеры ESC/POS через WebUSB).
 * ============================================================================
 *  Полностью автономен от BLE-контекста принтера (printer-context.tsx —
 *  только читаем его API, сам файл не меняем). Что делает:
 *    1. хранит транспорт печати 'ble' | 'usb' (localStorage mxw01-transport) —
 *       одна кнопка «Печать» в PrintDock уходит на выбранный транспорт;
 *    2. remember-подключение: при старте getDevices() возвращает устройство,
 *       авторизованное в прошлой сессии (Chrome запоминает разрешение);
 *    3. connect() — requestDevice() из клика (user gesture), с фильтрами
 *       класса 7 (printer) или «показать все USB» (fallback для клонов);
 *    4. printCanvas(canvas) — масштабирование под ширину бумаги (384/576/640),
 *       кодирование ESC/POS (GS v 0, дизеринг) и отправка в bulk-out;
 *    5. настройки ширины бумаги и авто-отреза (localStorage).
 *  Ошибки бросаются как Error с ГОТОВЫМ переводом (t()) — вкладки просто
 *  показывают e.message в тосте.
 * ============================================================================
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Translator } from "@/lib/printer/i18n";
import { readPosEnabled } from "@/lib/printer/pos-flag";
import { encodeEscposRaster } from "./escpos";
import { isBinaryRgba, resampleBinary, trimBlankRows, tsplTargetWidth } from "./raster";
import {
  clampGapMm,
  clampLabelHeight,
  clampLabelWidth,
  encodeTsplBitmap,
  encodeTsplGapDetect,
} from "./tspl";
import { clampUsbDpi, usbPosHeadDots, USB_DEFAULT_DPI, USB_POS_MAX_PRINT_MM } from "./raster";
import {
  UsbPrinterError,
  WebUsbPosPrinter,
  authorizedPrinters,
  deviceDisplayName,
  isWebUsbSupported,
  requestPosPrinter,
  type UsbPrinterErrorKey,
} from "./webusb-printer";

const TRANSPORT_KEY = "mxw01-transport";
const WIDTH_KEY = "mxw01-usb-width";
const CUT_KEY = "mxw01-usb-cut";
const LANG_KEY = "mxw01-usb-lang";
const LABEL_W_KEY = "mxw01-usb-label-w";
const LABEL_H_KEY = "mxw01-usb-label-h";
const GAP_KEY = "mxw01-usb-gap";
const INVERT_KEY = "mxw01-usb-invert";
const HQ_KEY = "mxw01-usb-hq";
const SPEED_KEY = "mxw01-usb-speed";
const DENSITY_KEY = "mxw01-usb-density";
const DPI_KEY = "mxw01-usb-dpi";
const MEDIA_KEY = "mxw01-usb-media";

/** Транспорт печати: BLE (MXW01) | USB (POS, за флагом) | HPRT (BT-этикетки, v1.0.55) */
export type PrintTransport = "ble" | "usb" | "hprt";

/** Язык команд USB-принтера: чековые — ESC/POS, этикеточные — TSPL */
export type UsbPrintLang = "escpos" | "tspl";

/** Тип носителя TSPL (v1.0.46): "gap" — этикетки с зазором (как раньше),
 *  "continuous" — непрерывная лента (GAP 0, длина = содержимому,
 *  пустые поля обрезаются — принтер не мотает лишнюю ленту перед печатью) */
export type UsbMedia = "gap" | "continuous";

export const USB_PAPER_WIDTHS = [384, 576, 640] as const;

export interface UsbPrintCanvasOptions {
  /** Ширина бумаги в точках: 384 (58 мм), 576/640 (80 мм) */
  paperWidth?: number;
  /** Дизеринг Флойда—Стейнберга (по умолчанию true) */
  dither?: boolean;
  /** Отрезать чек после печати (по умолчанию — настройка из контекста) */
  cut?: boolean;
  /** Прогресс отправки 0…1 */
  onProgress?: (p: number) => void;
}

interface UsbPrinterContextValue {
  /** WebUSB доступен (Chrome/Edge/Opera) */
  supported: boolean;
  transport: PrintTransport;
  setTransport: (t: PrintTransport) => void;
  /** Отображаемое имя выбранного USB-принтера (или null) */
  deviceName: string | null;
  hasDevice: boolean;
  connecting: boolean;
  /** Выбрать USB-принтер; allDevices — показать все USB (для клонов) */
  connect: (allDevices?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  printing: boolean;
  /** Прогресс отправки последней печати 0…1 */
  progress: number;
  paperWidth: number;
  setPaperWidth: (n: number) => void;
  cut: boolean;
  setCut: (b: boolean) => void;
  /** Язык команд: escpos (чековые) | tspl (этикетки: Gprinter, TSC…) */
  lang: UsbPrintLang;
  setLang: (l: UsbPrintLang) => void;
  /** Размеры этикетки и зазор (мм) — для TSPL */
  labelW: number;
  setLabelW: (n: number) => void;
  labelH: number;
  setLabelH: (n: number) => void;
  gapMm: number;
  setGapMm: (n: number) => void;
  /** Инверсия цветов канваса перед отправкой (ESC/POS и TSPL) — настройка в «Настройках» */
  invert: boolean;
  setInvert: (b: boolean) => void;
  /** Чёткая печать (v1.0.41): усиление контраста до бинаризации — в доке печати */
  hq: boolean;
  setHq: (b: boolean) => void;
  /** Скорость печати TSPL 1…6 (меньше — качественнее) */
  speed: number;
  setSpeed: (n: number) => void;
  /** Плотность (яркость) TSPL 0…15 (больше — темнее) */
  density: number;
  setDensity: (n: number) => void;
  /** Разрешение печатающей головки, dpi (v1.0.43): 203 — стандарт MXW01/BP21;
   *  влияет на растеризацию TSPL (точек на мм) и на печатную ширину POS —
   *  54 мм · dpi/25.4 = 432 точки при 203 dpi (v1.0.45); BLE считается по-прежнему */
  dpi: number;
  setDpi: (n: number) => void;
  /** Тип носителя TSPL (v1.0.46): "gap" — этикетки с зазором (по умолчанию),
   *  "continuous" — непрерывная лента: без поиска зазора (GAP 0), длина
   *  этикетки = содержимому, пустые поля сверху/снизу обрезаются —
   *  принтер не протягивает лишнюю ленту перед печатью */
  media: UsbMedia;
  setMedia: (m: UsbMedia) => void;
  /** Калибровка зазора (GAPDETECT) — принтер сам находит разрывы этикеток */
  calibrate: () => Promise<void>;
  /** Печать canvas по USB (ESC/POS или TSPL); ошибки — Error с готовым переводом */
  printCanvas: (canvas: HTMLCanvasElement, opts?: UsbPrintCanvasOptions) => Promise<void>;
}

const UsbPrinterContext = createContext<UsbPrinterContextValue | null>(null);

function readLsNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    /* нет localStorage — берём значение по умолчанию */
  }
  return fallback;
}

export function UsbPrinterProvider({
  children,
  t,
}: {
  children: React.ReactNode;
  /** Переводчик приходит ЧЕРЕЗ ПРОПС от корня страницы (см. AppRoot) */
  t: Translator;
}) {
  // - supported только после mount: SSR-разметка детерминирована (как язык в i18n),
  //   иначе гидратация расходится с серверным HTML -
  const [supported, setSupported] = useState(false);
  const [transport, setTransportState] = useState<PrintTransport>("ble");
  const [device, setDevice] = useState<USBDevice | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [paperWidth, setPaperWidthState] = useState(384);
  const [cut, setCutState] = useState(false);
  const [lang, setLangState] = useState<UsbPrintLang>("escpos");
  const [labelW, setLabelWState] = useState(40);
  const [labelH, setLabelHState] = useState(30);
  const [gapMm, setGapMmState] = useState(2);
  const [invert, setInvertState] = useState(false);
  const [hq, setHqState] = useState(false);
  const [speed, setSpeedState] = useState(4);
  const [density, setDensityState] = useState(8);
  const [dpi, setDpiState] = useState(USB_DEFAULT_DPI);
  const [media, setMediaState] = useState<UsbMedia>("gap");
  const deviceRef = useRef<USBDevice | null>(null);
  deviceRef.current = device;
  // Активная печать: защита от двойного запуска — второй сеанс не сможет
  // занять интерфейс (claimInterface: EBUSY) и напугает пользователя ошибкой
  const printingRef = useRef(false);

  // localStorage и поддержка WebUSB — только после монтирования
  useEffect(() => {
    const hasUsb = isWebUsbSupported();
    setSupported(hasUsb);
    try {
      const rawT = window.localStorage.getItem(TRANSPORT_KEY);
      if (rawT === "ble" || rawT === "usb" || rawT === "hprt") setTransportState(rawT);
      // - Экспериментальный POS (v1.0.48): флаг выключен — транспорт «usb»
      //   не восстанавливается; «hprt» (v1.0.55) — обычный транспорт,
      //   экспериментального флага не требует -
      if (rawT === "usb" && !readPosEnabled()) setTransportState("ble");
      const rawL = window.localStorage.getItem(LANG_KEY);
      if (rawL === "tspl" || rawL === "escpos") setLangState(rawL);
      setInvertState(window.localStorage.getItem(INVERT_KEY) === "1");
      setHqState(window.localStorage.getItem(HQ_KEY) === "1");
      try {
        const rawS = window.localStorage.getItem(SPEED_KEY);
        if (rawS !== null) {
          const n = Number(rawS);
          if (Number.isFinite(n)) setSpeedState(Math.min(6, Math.max(1, Math.round(n))));
        }
        const rawD = window.localStorage.getItem(DENSITY_KEY);
        if (rawD !== null) {
          const n = Number(rawD);
          if (Number.isFinite(n)) setDensityState(Math.min(15, Math.max(0, Math.round(n))));
        }
        const rawDpi = window.localStorage.getItem(DPI_KEY);
        if (rawDpi !== null) {
          const n = Number(rawDpi);
          if (Number.isFinite(n)) setDpiState(clampUsbDpi(n));
        }
      } catch {
        /* нет localStorage — дефолты 4/8/203 */
      }
      const rawM = window.localStorage.getItem(MEDIA_KEY);
      if (rawM === "gap" || rawM === "continuous") setMediaState(rawM);
    } catch {
      /* нет localStorage — дефолт */
    }
    setLabelWState(clampLabelWidth(readLsNumber(LABEL_W_KEY, 40)));
    setLabelHState(clampLabelHeight(readLsNumber(LABEL_H_KEY, 30)));
    setGapMmState(clampGapMm(readLsNumber(GAP_KEY, 2)));
    if (!hasUsb) return;
    setPaperWidthState(readLsNumber(WIDTH_KEY, 384));
    try {
      setCutState(window.localStorage.getItem(CUT_KEY) === "1");
    } catch {
      /* дефолт false */
    }
    // Уже авторизованные ранее устройства — считаем «подключёнными»
    authorizedPrinters().then((list) => {
      if (list.length > 0) setDevice(list[0]);
    });
  }, []);

  const setTransport = useCallback((t2: PrintTransport) => {
    setTransportState(t2);
    try {
      window.localStorage.setItem(TRANSPORT_KEY, t2);
    } catch {
      /* не критично */
    }
  }, []);

  const setPaperWidth = useCallback((n: number) => {
    const clamped = USB_PAPER_WIDTHS.includes(n as (typeof USB_PAPER_WIDTHS)[number]) ? n : 384;
    setPaperWidthState(clamped);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      /* не критично */
    }
  }, []);

  const setCut = useCallback((b: boolean) => {
    setCutState(b);
    try {
      window.localStorage.setItem(CUT_KEY, b ? "1" : "0");
    } catch {
      /* не критично */
    }
  }, []);

  const setLang = useCallback((l: UsbPrintLang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* не критично */
    }
  }, []);

  const setLabelW = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = clampLabelWidth(n);
    setLabelWState(c);
    try {
      window.localStorage.setItem(LABEL_W_KEY, String(c));
    } catch {
      /* не критично */
    }
  }, []);

  const setLabelH = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = clampLabelHeight(n);
    setLabelHState(c);
    try {
      window.localStorage.setItem(LABEL_H_KEY, String(c));
    } catch {
      /* не критично */
    }
  }, []);

  const setGapMm = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = clampGapMm(n);
    setGapMmState(c);
    try {
      window.localStorage.setItem(GAP_KEY, String(c));
    } catch {
      /* не критично */
    }
  }, []);

  const setInvert = useCallback((b: boolean) => {
    setInvertState(b);
    try {
      window.localStorage.setItem(INVERT_KEY, b ? "1" : "0");
    } catch {
      /* не критично */
    }
  }, []);

  const setHq = useCallback((b: boolean) => {
    setHqState(b);
    try {
      window.localStorage.setItem(HQ_KEY, b ? "1" : "0");
    } catch {
      /* не критично */
    }
  }, []);

  const setSpeed = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = Math.min(6, Math.max(1, Math.round(n)));
    setSpeedState(c);
    try {
      window.localStorage.setItem(SPEED_KEY, String(c));
    } catch {
      /* не критично */
    }
  }, []);

  const setDensity = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = Math.min(15, Math.max(0, Math.round(n)));
    setDensityState(c);
    try {
      window.localStorage.setItem(DENSITY_KEY, String(c));
    } catch {
      /* не критично */
    }
  }, []);

  const setDpi = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = clampUsbDpi(n);
    setDpiState(c);
    try {
      window.localStorage.setItem(DPI_KEY, String(c));
    } catch {
      /* не критично */
    }
  }, []);

  const setMedia = useCallback((m: UsbMedia) => {
    setMediaState(m);
    try {
      window.localStorage.setItem(MEDIA_KEY, m);
    } catch {
      /* не критично */
    }
  }, []);

  const translateError = useCallback(
    (key: UsbPrinterErrorKey): string => {
      const map: Record<UsbPrinterErrorKey, string> = {
        cancelled: t("usb.err.cancelled"),
        noDevice: t("usb.err.noDevice"),
        noBulk: t("usb.err.noBulk"),
        openFailed: t("usb.err.openFailed"),
        openDenied: t("usb.err.openDenied"),
        claimFailed: t("usb.err.claimFailed"),
        transferFailed: t("usb.err.transferFailed"),
        transferTimeout: t("usb.err.transferTimeout"),
      };
      return map[key] ?? key;
    },
    [t]
  );

  /** Короткая техническая подпись причины (имя DOMException) — для диагностики */
  const techDetail = useCallback((e: unknown): string => {
    const cause = (e as { cause?: unknown })?.cause;
    if (cause && typeof cause === "object" && "name" in cause) {
      const name = String((cause as { name?: unknown }).name);
      if (name && name !== "Error" && name !== "UsbPrinterError") return name;
    }
    return "";
  }, []);

  /** Выбрать принтер из системного диалога (нужен клик — user gesture) */
  const connect = useCallback(
    async (allDevices = false) => {
      if (!isWebUsbSupported()) throw new Error(t("usb.unsupported"));
      if (connecting) return;
      setConnecting(true);
      try {
        const dev = await requestPosPrinter(allDevices);
        setDevice(dev);
      } catch (e) {
        if (e instanceof UsbPrinterError) {
          const detail = techDetail(e);
          throw new Error(translateError(e.key) + (detail ? ` [${detail}]` : ""));
        }
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [connecting, t, techDetail, translateError]
  );

  const disconnect = useCallback(async () => {
    const dev = deviceRef.current;
    setDevice(null);
    if (!dev) return;
    try {
      // forget() убирает авторизацию (Chrome 101+); нет — просто забываем в UI
      const forgettable = dev as USBDevice & { forget?: () => Promise<void> };
      if (typeof forgettable.forget === "function") await forgettable.forget();
    } catch {
      /* не критично */
    }
  }, []);

  /** Масштабирование холста под ширину бумаги (если головка шире 384 px) */
  const rasterize = useCallback(
    (canvas: HTMLCanvasElement, target: number) => {
      const srcCtx = canvas.getContext("2d");
      if (!srcCtx) throw new Error(t("pc.canvasUnavailable"));
      if (canvas.width === target) {
        return srcCtx.getImageData(0, 0, canvas.width, canvas.height);
      }
      const off = document.createElement("canvas");
      off.width = target;
      off.height = Math.max(1, Math.round((canvas.height * target) / canvas.width));
      const octx = off.getContext("2d");
      if (!octx) throw new Error(t("pc.canvasUnavailable"));
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = "high";
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, off.width, off.height);
      octx.drawImage(canvas, 0, 0, off.width, off.height);
      return octx.getImageData(0, 0, off.width, off.height);
    },
    [t]
  );

  /** Калибровка зазора TSPL-принтера: GAPDETECT — принтер сам находит разрывы */
  const calibrate = useCallback(async () => {
    if (!isWebUsbSupported()) throw new Error(t("usb.unsupported"));
    if (printingRef.current) throw new Error(t("usb.err.busy"));
    let dev = deviceRef.current;
    if (!dev) {
      // Запрос устройства прямо из клика (user gesture)
      dev = await requestPosPrinter(false);
      setDevice(dev);
    }
    printingRef.current = true;
    const session = new WebUsbPosPrinter();
    try {
      await session.open(dev);
      await session.send(encodeTsplGapDetect());
    } catch (e) {
      if (e instanceof UsbPrinterError) {
        const detail = techDetail(e);
        throw new Error(translateError(e.key) + (detail ? ` [${detail}]` : ""));
      }
      throw e;
    } finally {
      printingRef.current = false;
      await session.close();
    }
  }, [t, techDetail, translateError]);

  const printCanvas = useCallback(
    async (canvas: HTMLCanvasElement, opts?: UsbPrintCanvasOptions) => {
      if (!isWebUsbSupported()) throw new Error(t("usb.unsupported"));
      if (printingRef.current) throw new Error(t("usb.err.busy"));
      // Принтер не выбран — запрашиваем прямо из этого клика (user gesture)
      let dev = deviceRef.current;
      if (!dev) {
        dev = await requestPosPrinter(false);
        setDevice(dev);
      }
      // v1.0.42: весь контент приложения (чек, текст, ценники, копии, лента)
      // приходит СТРОГО чёрно-белым холстом. Для бинарного источника дизеринг
      // Флойда—Стейнберга бессмыслен (серых пикселей нет), а после сглаженного
      // ресемпла под ширину этикетки/бумаги он рассыпает серые края букв в
      // шумные точки — печать выглядит нечёткой. Поэтому: бинарный источник →
      // box-усреднение + жёсткий порог (уменьшение) / nearest (увеличение),
      // дизеринг выключен; полутоновые источники (фото с серыми) — прежний
      // путь: сглаживание + дизеринг.
      const srcCtx = canvas.getContext("2d");
      if (!srcCtx) throw new Error(t("pc.canvasUnavailable"));
      const srcImg = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
      const binary = isBinaryRgba(srcImg.data);
      const src = { data: srcImg.data, width: srcImg.width, height: srcImg.height };
      const dither = binary ? false : (opts?.dither ?? true);
      const bytes =
        lang === "tspl"
          ? (() => {
              // Разрешение головки (v1.0.43): контент спроектирован на сетке
              // 8 px/мм (203 dpi). При DPI из настроек растр масштабируется к
              // физическому размеру этикетки (мм · точек/мм), ужимание —
              // ТОЛЬКО по ширине (v1.0.40), по высоте — никогда: картинки и
              // копии печатаются 1:1, а высота SIZE растёт под содержимое
              // (авто-длина). При 203 dpi математика идентична прежней.
              // v1.0.45: POS-ветка считает плотность от характеристик принтера
              // (BP21: 203 dpi = 8 точек/мм, печатная ширина 54 мм → 432
              // точки). Этикетка шире головки обрезается до печатной ширины —
              // и в растре, и в SIZE: физически шире 54 мм принтер не напечатает.
              // BLE (MXW01) считает плотность по-прежнему — эта правка не трогает.
              const effLabelW = Math.min(labelW, USB_POS_MAX_PRINT_MM);
              const { target, dotsPerMm } = tsplTargetWidth(canvas.width, effLabelW, dpi);
              let img = binary ? resampleBinary(src, target) : rasterize(canvas, target);
              // Экономия ленты (v1.0.46 → v1.0.47): пустые поля сверху/снизу
              // (поля картинки, «хвост» фиксированной страницы ленты) не должны
              // уходить в печать: с ведущим краем растра (v1.0.47, BITMAP
              // y = labelPxH − rows) пустой НИЗ холста печатается ПЕРВЫМ куском
              // ленты — обрезаем в ОБОИХ режимах носителя. Только для строго
              // бинарных растров (полутона дизеринг печатает точками — их
              // нельзя резать) и без «Инверсии канваса» (при инверсии белый
              // фон печатается ЧЁРНЫМ — это контент, а не пустота).
              if (binary && !invert) {
                img = trimBlankRows(img);
              }
              return encodeTsplBitmap(
                { data: img.data, width: img.width, height: img.height },
                {
                  labelWidthMm: effLabelW,
                  labelHeightMm: labelH,
                  gapMm,
                  dither,
                  invert,
                  autoHeight: true,
                  // Непрерывная лента: GAP 0 (нет поиска разрыва датчиком —
                  // на рулонной ленте он заставляет принтер протянуть много
                  // ленты до начала печати) и длина этикетки ровно под контент
                  continuous: media === "continuous",
                  enhance: hq,
                  speed,
                  density,
                  dotsPerMm,
                }
              );
            })()
          : encodeEscposRaster(
              (() => {
                // v1.0.45: растр POS не шире головки (54 мм × dpi/25.4 =
                // 432 точки при 203 dpi): выбранная ширина бумаги 576/640
                // на BP21 ужимается до печатной ширины головки, 384 —
                // влезает целиком (WYSIWYG с превью 384 px)
                const target = Math.min(opts?.paperWidth ?? paperWidth, usbPosHeadDots(dpi));
                const image = binary ? resampleBinary(src, target) : rasterize(canvas, target);
                // v1.0.47: пустые поля холста — пустая лента ДО содержимого
                // (ESC/POS печатает строки как пришли, ряд 0 первым). Обрезаем
                // как в TSPL: строго бинарные, без инверсии.
                const clean = binary && !invert ? trimBlankRows(image) : image;
                return { data: clean.data, width: clean.width, height: clean.height };
              })(),
              {
                dither,
                // Бинарный источник: порог 128 — как в бинаризации холста
                // (WYSIWYG); для полутонов остаётся дефолт 150
                threshold: binary ? 128 : undefined,
                chunkRows: 64,
                // Выравнивание по левому краю — всегда (v1.0.38): ESC @
                // сбрасывает выравнивание, центрирование не включаем
                center: false,
                invert,
                enhance: hq,
                feedLines: 3,
                cut: opts?.cut ?? cut,
              }
            );
      setPrinting(true);
      printingRef.current = true;
      setProgress(0);
      const session = new WebUsbPosPrinter();
      try {
        await session.open(dev);
        await session.send(bytes, (p) => {
          setProgress(p);
          opts?.onProgress?.(p);
        });
      } catch (e) {
        if (e instanceof UsbPrinterError) {
          const detail = techDetail(e);
          throw new Error(translateError(e.key) + (detail ? ` [${detail}]` : ""));
        }
        throw e;
      } finally {
        printingRef.current = false;
        await session.close();
        setPrinting(false);
      }
    },
    [cut, gapMm, invert, labelH, labelW, lang, paperWidth, hq, speed, density, dpi, media, rasterize, t, techDetail, translateError]
  );

  const deviceName = useMemo(() => (device ? deviceDisplayName(device) : null), [device]);

  const value = useMemo<UsbPrinterContextValue>(
    () => ({
      supported,
      transport,
      setTransport,
      deviceName,
      hasDevice: device !== null,
      connecting,
      connect,
      disconnect,
      printing,
      progress,
      paperWidth,
      setPaperWidth,
      cut,
      setCut,
      lang,
      setLang,
      labelW,
      setLabelW,
      labelH,
      setLabelH,
      gapMm,
      setGapMm,
      invert,
      setInvert,
      hq,
      setHq,
      speed,
      setSpeed,
      density,
      setDensity,
      dpi,
      setDpi,
      media,
      setMedia,
      calibrate,
      printCanvas,
    }),
    [
      supported,
      transport,
      setTransport,
      deviceName,
      device,
      connecting,
      connect,
      disconnect,
      printing,
      progress,
      paperWidth,
      setPaperWidth,
      cut,
      setCut,
      lang,
      setLang,
      labelW,
      setLabelW,
      labelH,
      setLabelH,
      gapMm,
      setGapMm,
      invert,
      setInvert,
      hq,
      setHq,
      speed,
      setSpeed,
      density,
      setDensity,
      dpi,
      setDpi,
      media,
      setMedia,
      calibrate,
      printCanvas,
    ]
  );

  return <UsbPrinterContext.Provider value={value}>{children}</UsbPrinterContext.Provider>;
}

export function useUsbPrinter(): UsbPrinterContextValue {
  const ctx = useContext(UsbPrinterContext);
  if (!ctx) throw new Error("useUsbPrinter must be used within UsbPrinterProvider");
  return ctx;
}
