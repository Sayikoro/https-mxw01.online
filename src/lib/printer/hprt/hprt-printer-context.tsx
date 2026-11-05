"use client";
/**
 * ============================================================================
 *  КОНТЕКСТ HPRT-ПЕЧАТИ (этикеточный принтер по Bluetooth: HPRT T260LR…).
 * ============================================================================
 *  Третий транспорт (v1.0.55) рядом с BLE (MXW01) и POS-USB:
 *    1. BLE-соединение — HprtBleTransport (автопрофиль GATT, чанки);
 *    2. printCanvas(canvas) — тот же ч/б конвейер, что у POS-USB, но
 *       кодирование под T260LR: TSPL-растр (по умолчанию) или ESC/POS;
 *       ширина головки 384 точки (48 мм × 8 точек/мм при 203 dpi);
 *       носитель linerless («LR»-рулон без подложки) — continuous по
 *       умолчанию, переключение на «gap» — для обычных этикеток;
 *    3. настройки в localStorage (mxw01-hprt-*): носитель, размеры
 *       этикетки и зазор, плотность/скорость, инверсия, чёткая печать,
 *       язык команд, размер чанка и пауза между чанками (диагностика);
 *    4. журнал (logs) для «Диагностики Bluetooth»: подключение, профиль,
 *       объём отправки; sendRaw() и enumerateServices() — для raw-консоли.
 *  Ошибки бросаются как Error с ГОТОВЫМ переводом (t()) — вкладки просто
 *  показывают e.message в тосте (как в usb-printer-context).
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
import {
  HprtBleError,
  HprtBleTransport,
  clampChunk,
  clampDelay,
  HPRT_CHUNK_DEFAULT,
  HPRT_DELAY_DEFAULT,
  webBluetoothAvailable,
  type BleProfileInfo,
  type DiscoveredService,
} from "./ble-transport";
import { encodeEscposRaster } from "@/lib/printer/usb/escpos";
import {
  isBinaryRgba,
  resampleBinary,
  trimBlankRows,
  tsplTargetWidth,
  USB_BASE_DPI,
} from "@/lib/printer/usb/raster";
import {
  clampGapMm,
  clampLabelHeight,
  clampLabelWidth,
  encodeTsplBitmap,
} from "@/lib/printer/usb/tspl";

/* ------------------------------- Типы ---------------------------------- */

export type HprtStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "printing";

/** Язык команд HPRT: этикеточный TSPL (по умолчанию) или чековый ESC/POS */
export type HprtProtocol = "tspl" | "escpos";

/** Носитель: linerless-рулон (continuous, GAP 0) или этикетки с зазором */
export type HprtMedia = "continuous" | "gap";

/* --------------------- Характеристики T260LR --------------------------- */

/** Ширина головки T260LR: 48 мм × 8 точек/мм (203 dpi) = 384 точки */
export const HPRT_HEAD_DOTS = 384;
/** Максимальная печатная ширина, мм (спецификация HPRT T260LR) */
export const HPRT_MAX_PRINT_MM = 48;
/** DPI головки T260LR */
export const HPRT_DPI = 203;

/* --------------------------- localStorage ------------------------------ */

const MEDIA_KEY = "mxw01-hprt-media";
const PROTOCOL_KEY = "mxw01-hprt-protocol";
const LABEL_W_KEY = "mxw01-hprt-label-w";
const LABEL_H_KEY = "mxw01-hprt-label-h";
const GAP_KEY = "mxw01-hprt-gap";
const DENSITY_KEY = "mxw01-hprt-density";
const SPEED_KEY = "mxw01-hprt-speed";
const INVERT_KEY = "mxw01-hprt-invert";
const HQ_KEY = "mxw01-hprt-hq";
const CHUNK_KEY = "mxw01-hprt-chunk";
const DELAY_KEY = "mxw01-hprt-delay";

function readLsNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {
    /* нет localStorage — берём значение по умолчанию */
  }
  return fallback;
}

function readLsFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeLs(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* переполнение — настройка живёт до перезагрузки */
  }
}

/** URL-параметры диагностики (?nobt=1, ?fakebt=<мс>) — как в printer-context */
function urlHas(name: string): boolean {
  try {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
}

/* ------------------------------ Контекст ------------------------------- */

interface HprtPrinterContextValue {
  /** Web Bluetooth доступен (Chrome/Edge/Opera, beacio для Safari) */
  supported: boolean;
  status: HprtStatus;
  deviceName: string | null;
  /** Найденный GATT-профиль (после подключения) */
  profile: BleProfileInfo | null;
  lastError: string | null;
  /** Журнал для «Диагностики Bluetooth» (последние 400 строк) */
  logs: string[];
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Карта сервисов/характеристик подключённого принтера */
  enumerate: () => Promise<DiscoveredService[]>;
  /** Raw-консоль диагностики: отправить сырые байты */
  sendRaw: (bytes: Uint8Array) => Promise<void>;
  clearLogs: () => void;
  /** Печать canvas; ошибки — Error с готовым переводом */
  printCanvas: (canvas: HTMLCanvasElement, opts?: HprtPrintCanvasOptions) => Promise<void>;
  /** Прогресс отправки последней печати 0…1 */
  progress: number;
  /* Настройки */
  protocol: HprtProtocol;
  setProtocol: (p: HprtProtocol) => void;
  media: HprtMedia;
  setMedia: (m: HprtMedia) => void;
  labelW: number;
  setLabelW: (n: number) => void;
  labelH: number;
  setLabelH: (n: number) => void;
  gapMm: number;
  setGapMm: (n: number) => void;
  density: number;
  setDensity: (n: number) => void;
  speed: number;
  setSpeed: (n: number) => void;
  invert: boolean;
  setInvert: (b: boolean) => void;
  hq: boolean;
  setHq: (b: boolean) => void;
  /** Размер BLE-чанка, байт (диагностика: 20 по умолчанию) */
  chunkSize: number;
  setChunkSize: (n: number) => void;
  /** Пауза между чанками, мс (диагностика: 0 по умолчанию) */
  chunkDelayMs: number;
  setChunkDelayMs: (n: number) => void;
}

export interface HprtPrintCanvasOptions {
  /** Дизеринг для полутоновых источников (бинарные всегда без дизеринга) */
  dither?: boolean;
  /** Прогресс отправки 0…1 */
  onProgress?: (p: number) => void;
}

const HprtPrinterContext = createContext<HprtPrinterContextValue | null>(null);

export function HprtPrinterProvider({
  children,
  t,
}: {
  children: React.ReactNode;
  /** Переводчик приходит ЧЕРЕЗ ПРОПС от корня страницы (см. AppRoot) */
  t: Translator;
}) {
  const transportRef = useRef<HprtBleTransport | null>(null);
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<HprtStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [profile, setProfile] = useState<BleProfileInfo | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  // - supported только после mount: SSR-разметка детерминирована (как в
  //   usb-printer-context), иначе гидратация расходится с серверным HTML -
  const [protocol, setProtocolState] = useState<HprtProtocol>("tspl");
  const [media, setMediaState] = useState<HprtMedia>("continuous");
  const [labelW, setLabelWState] = useState(HPRT_MAX_PRINT_MM);
  const [labelH, setLabelHState] = useState(30);
  const [gapMm, setGapMmState] = useState(2);
  const [density, setDensityState] = useState(8);
  const [speed, setSpeedState] = useState(4);
  const [invert, setInvertState] = useState(false);
  const [hq, setHqState] = useState(false);
  const [chunkSize, setChunkSizeState] = useState(HPRT_CHUNK_DEFAULT);
  const [chunkDelayMs, setChunkDelayMsState] = useState(HPRT_DELAY_DEFAULT);
  const printingRef = useRef(false);

  const log = useCallback((line: string) => {
    setLogs((prev) => {
      const next = prev.length >= 400 ? prev.slice(prev.length - 399) : prev.slice();
      next.push(line);
      return next;
    });
  }, []);

  /* --- localStorage и живая проверка Web Bluetooth (после монтирования) ---
   * API может появиться ПОСЛЕ загрузки страницы (beacio в Safari инжектирует
   * navigator.bluetooth) — опрашиваем раз в секунду, как BLE-контекст. */
  useEffect(() => {
    try {
      const rawP = window.localStorage.getItem(PROTOCOL_KEY);
      if (rawP === "tspl" || rawP === "escpos") setProtocolState(rawP);
      const rawM = window.localStorage.getItem(MEDIA_KEY);
      if (rawM === "gap" || rawM === "continuous") setMediaState(rawM);
      setInvertState(readLsFlag(INVERT_KEY));
      setHqState(readLsFlag(HQ_KEY));
      setChunkSizeState(clampChunk(readLsNumber(CHUNK_KEY, HPRT_CHUNK_DEFAULT)));
      setChunkDelayMsState(clampDelay(readLsNumber(DELAY_KEY, HPRT_DELAY_DEFAULT)));
      const rawD = readLsNumber(DENSITY_KEY, 8);
      if (Number.isFinite(rawD)) setDensityState(Math.min(15, Math.max(0, Math.round(rawD))));
      const rawS = readLsNumber(SPEED_KEY, 4);
      if (Number.isFinite(rawS)) setSpeedState(Math.min(6, Math.max(1, Math.round(rawS))));
    } catch {
      /* нет localStorage — дефолты */
    }
    setLabelWState(clampLabelWidth(readLsNumber(LABEL_W_KEY, HPRT_MAX_PRINT_MM)));
    setLabelHState(clampLabelHeight(readLsNumber(LABEL_H_KEY, 30)));
    setGapMmState(clampGapMm(readLsNumber(GAP_KEY, 2)));
    const check = () => setSupported(!urlHas("nobt") && webBluetoothAvailable());
    check();
    const iv = setInterval(check, 1000);
    const onChange = () => check();
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onChange);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, []);

  useEffect(() => {
    if (!supported) {
      setStatus((prev) => (prev === "disconnected" ? "unsupported" : prev));
      return;
    }
    setStatus((prev) => (prev === "unsupported" ? "disconnected" : prev));
  }, [supported]);

  const ensureTransport = useCallback((): HprtBleTransport => {
    if (!transportRef.current) {
      transportRef.current = new HprtBleTransport();
      // Обрыв соединения (принтер выключили) — честный статус без перезагрузки
      transportRef.current.onDisconnected = () => {
        setStatus("disconnected");
        setProfile(null);
        setDeviceName(null);
      };
    }
    return transportRef.current;
  }, []);

  const translateError = useCallback(
    (key: HprtBleError["key"]): string => {
      const map: Record<HprtBleError["key"], string> = {
        cancelled: t("hprt.err.cancelled"),
        noApi: t("hprt.unsupported"),
        noGatt: t("hprt.err.connectFailed"),
        noProfile: t("hprt.err.noProfile"),
        notConnected: t("hprt.err.notConnected"),
        busy: t("hprt.err.busy"),
        failed: t("hprt.err.transferFailed"),
        paper: t("hprt.err.paper"),
        cover: t("hprt.err.cover"),
        overheat: t("hprt.err.overheat"),
        lowPower: t("hprt.err.lowPower"),
        pause: t("hprt.err.pause"),
      };
      return map[key] ?? key;
    },
    [t]
  );

  const connect = useCallback(async () => {
    if (!supported) throw new Error(t("hprt.unsupported"));
    if (status === "connecting" || status === "connected" || status === "printing") return;
    setLastError(null);
    setStatus("connecting");
    const tr = ensureTransport();
    try {
      const name = await tr.connect(log);
      setDeviceName(name || "HPRT");
      setProfile(tr.profile);
      setStatus("connected");
      log(`${name || "HPRT"} — готов к печати`);
    } catch (e) {
      setStatus("disconnected");
      if (e instanceof HprtBleError) {
        const msg = translateError(e.key);
        setLastError(msg);
        throw new Error(msg);
      }
      const msg = (e as Error)?.message ?? t("hprt.err.connectFailed");
      setLastError(msg);
      throw new Error(msg);
    }
  }, [ensureTransport, log, status, supported, t, translateError]);

  const disconnect = useCallback(async () => {
    const tr = transportRef.current;
    if (tr) {
      try {
        await tr.disconnect();
      } catch {
        /* уже разорвано */
      }
    }
    setStatus(supported ? "disconnected" : "unsupported");
    setProfile(null);
    setDeviceName(null);
  }, [supported]);

  /** Масштабирование холста под ширину печати (как в usb-printer-context) */
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

  const printCanvas = useCallback(
    async (canvas: HTMLCanvasElement, opts?: HprtPrintCanvasOptions) => {
      if (!supported) throw new Error(t("hprt.unsupported"));
      if (printingRef.current) throw new Error(t("hprt.err.busy"));
      const tr = ensureTransport();
      // Принтер не подключён — подключаем прямо из этого клика (user gesture)
      if (!tr.isConnected()) {
        await connect();
      }
      // Весь контент приложения приходит СТРОГО чёрно-белым холстом
      // (canvas-quality.ts) — та же логика, что в POS-USB (v1.0.42):
      // бинарный источник — без дизеринга, ресемпл box/nearest.
      const srcCtx = canvas.getContext("2d");
      if (!srcCtx) throw new Error(t("pc.canvasUnavailable"));
      const srcImg = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
      const binary = isBinaryRgba(srcImg.data);
      const src = { data: srcImg.data, width: srcImg.width, height: srcImg.height };
      const dither = binary ? false : (opts?.dither ?? true);
      const bytes =
        protocol === "tspl"
          ? (() => {
              // Ширина этикетки зажимается в печатную ширину головки T260LR
              // (48 мм = 384 точки при 203 dpi); растр шире — обрезается
              // по ширине, высота — авто (SIZE растёт под содержимое)
              const effLabelW = Math.min(labelW, HPRT_MAX_PRINT_MM);
              const { target, dotsPerMm } = tsplTargetWidth(canvas.width, effLabelW, HPRT_DPI);
              let img = binary ? resampleBinary(src, target) : rasterize(canvas, target);
              // Пустые поля сверху/снизу — чистый расход ленты (v1.0.46/47)
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
                  // Linerless (LR): GAP 0 — датчик не ищет разрыв, которого
                  // у рулона без подложки нет; длина = содержимому
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
                // ESC/POS (чековый режим): растр ровно в головку 384 точки
                const image = binary ? resampleBinary(src, HPRT_HEAD_DOTS) : rasterize(canvas, HPRT_HEAD_DOTS);
                const clean = binary && !invert ? trimBlankRows(image) : image;
                return { data: clean.data, width: clean.width, height: clean.height };
              })(),
              {
                dither,
                threshold: binary ? 128 : undefined,
                chunkRows: 64,
                center: false,
                invert,
                enhance: hq,
                feedLines: 3,
                cut: false,
              }
            );
      setStatus("printing");
      printingRef.current = true;
      setProgress(0);
      try {
        await tr.send(bytes, {
          chunkSize,
          chunkDelayMs,
          onProgress: (p) => {
            setProgress(p);
            opts?.onProgress?.(p);
          },
          log,
        });
        setStatus("connected");
      } catch (e) {
        setStatus("connected");
        if (e instanceof HprtBleError) {
          const msg = translateError(e.key);
          setLastError(msg);
          throw new Error(msg);
        }
        const msg = (e as Error)?.message ?? t("hprt.err.transferFailed");
        setLastError(msg);
        throw new Error(msg);
      } finally {
        printingRef.current = false;
      }
    },
    [
      chunkDelayMs,
      chunkSize,
      connect,
      ensureTransport,
      gapMm,
      hq,
      invert,
      labelH,
      labelW,
      log,
      media,
      protocol,
      rasterize,
      speed,
      supported,
      t,
      translateError,
    ]
  );

  const enumerate = useCallback(async (): Promise<DiscoveredService[]> => {
    const tr = transportRef.current;
    if (!tr?.isConnected()) throw new Error(t("hprt.err.notConnected"));
    return tr.enumerateServices();
  }, [t]);

  const sendRaw = useCallback(
    async (bytes: Uint8Array) => {
      const tr = transportRef.current;
      if (!tr?.isConnected()) throw new Error(t("hprt.err.notConnected"));
      await tr.sendRaw(bytes, { chunkSize, chunkDelayMs, log });
    },
    [chunkDelayMs, chunkSize, log, t]
  );

  const clearLogs = useCallback(() => setLogs([]), []);

  const setProtocol = useCallback((p: HprtProtocol) => {
    setProtocolState(p);
    writeLs(PROTOCOL_KEY, p);
  }, []);

  const setMedia = useCallback((m: HprtMedia) => {
    setMediaState(m);
    writeLs(MEDIA_KEY, m);
  }, []);

  const setLabelW = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = clampLabelWidth(n);
    setLabelWState(c);
    writeLs(LABEL_W_KEY, String(c));
  }, []);

  const setLabelH = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = clampLabelHeight(n);
    setLabelHState(c);
    writeLs(LABEL_H_KEY, String(c));
  }, []);

  const setGapMm = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = clampGapMm(n);
    setGapMmState(c);
    writeLs(GAP_KEY, String(c));
  }, []);

  const setDensity = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = Math.min(15, Math.max(0, Math.round(n)));
    setDensityState(c);
    writeLs(DENSITY_KEY, String(c));
  }, []);

  const setSpeed = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const c = Math.min(6, Math.max(1, Math.round(n)));
    setSpeedState(c);
    writeLs(SPEED_KEY, String(c));
  }, []);

  const setInvert = useCallback((b: boolean) => {
    setInvertState(b);
    writeLs(INVERT_KEY, b ? "1" : "0");
  }, []);

  const setHq = useCallback((b: boolean) => {
    setHqState(b);
    writeLs(HQ_KEY, b ? "1" : "0");
  }, []);

  const setChunkSize = useCallback((n: number) => {
    const c = clampChunk(n);
    setChunkSizeState(c);
    writeLs(CHUNK_KEY, String(c));
  }, []);

  const setChunkDelayMs = useCallback((n: number) => {
    const c = clampDelay(n);
    setChunkDelayMsState(c);
    writeLs(DELAY_KEY, String(c));
  }, []);

  const value = useMemo<HprtPrinterContextValue>(
    () => ({
      supported,
      status,
      deviceName,
      profile,
      lastError,
      logs,
      connect,
      disconnect,
      enumerate,
      sendRaw,
      clearLogs,
      printCanvas,
      progress,
      protocol,
      setProtocol,
      media,
      setMedia,
      labelW,
      setLabelW,
      labelH,
      setLabelH,
      gapMm,
      setGapMm,
      density,
      setDensity,
      speed,
      setSpeed,
      invert,
      setInvert,
      hq,
      setHq,
      chunkSize,
      setChunkSize,
      chunkDelayMs,
      setChunkDelayMs,
    }),
    [
      supported,
      status,
      deviceName,
      profile,
      lastError,
      logs,
      connect,
      disconnect,
      enumerate,
      sendRaw,
      clearLogs,
      printCanvas,
      progress,
      protocol,
      setProtocol,
      media,
      setMedia,
      labelW,
      setLabelW,
      labelH,
      setLabelH,
      gapMm,
      setGapMm,
      density,
      setDensity,
      speed,
      setSpeed,
      invert,
      setInvert,
      hq,
      setHq,
      chunkSize,
      setChunkSize,
      chunkDelayMs,
      setChunkDelayMs,
    ]
  );

  return <HprtPrinterContext.Provider value={value}>{children}</HprtPrinterContext.Provider>;
}

export function useHprtPrinter(): HprtPrinterContextValue {
  const ctx = useContext(HprtPrinterContext);
  if (!ctx) throw new Error("useHprtPrinter must be used within HprtPrinterProvider");
  return ctx;
}
