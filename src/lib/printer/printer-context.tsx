"use client";
/**
 * ============================================================================
 *  КОНТЕКСТ ПРИНТЕРА — обёртка над драйвером `mxw01-thermal-printer`.
 * ============================================================================
 *  ВАЖНО / IMPORTANT:
 *  Сам ДРАЙВЕР (BLE-протокол MXW01, команда 0x22 0x21, CRC8, нарезка чанков
 *  данных, интенсивность, отправка на печать) находится внутри библиотеки
 *  `mxw01-thermal-printer` и используется КАК ЕСТЬ, БЕЗ ИЗМЕНЕНИЙ.
 *
 *  Эта обёртка делает только три вещи:
 *    1. connect()  — запрос устройства через Web Bluetooth и подключение;
 *    2. disconnect();
 *    3. printCanvas(canvas) — передача ImageData холста в driver.print().
 *
 *  Никакой собственной логики печати / преобразования протокола здесь нет.
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
import {
  ThermalPrinterClient,
  WebBluetoothAdapter,
} from "mxw01-thermal-printer";
import type { PrinterState } from "mxw01-thermal-printer";
import type { Translator } from "@/lib/printer/i18n";

export type ConnectionStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "printing";

/** Фирменный таймаут драйвера («Timeout waiting for notification 0xa1»):
 *  GATT-соединение открылось, но принтер молчит на статус-запрос — обычно
 *  это не MXW01, а «котиковый» принтер (MX10/GB03…, сервис ae30 у клонов).
 *  В v1.0.62 такие ошибки распознаются и показываются подсказкой
 *  с переключением на cat-транспорт (баннер в шапке). */
const NOT_MXW01_RE = /timeout waiting for notification/i;

interface PrinterContextValue {
  status: ConnectionStatus;
  /** Живая поддержка Web Bluetooth: может появиться ПОСЛЕ загрузки страницы,
   *  когда пользователь включит beacio (Safari-расширение инжектирует API) */
  supported: boolean;
  deviceName: string | null;
  /** Ключ i18n-словаря (переводится в шапке через t()); не готовый текст */
  statusMessage: string;
  printerState: PrinterState | null;
  lastError: string | null;
  /** v1.0.62: последняя ошибка похожа на «чужой принтер» (таймаут статуса)
   *  — шапка показывает баннер с переключением на MX10 (cat) */
  notMxw01Hint: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Печать содержимого canvas.
   * Параметры (dither/brightness/intensity) передаются напрямую в драйвер.
   */
  printCanvas: (canvas: HTMLCanvasElement, opts?: PrintCanvasOptions) => Promise<void>;
  /** Ручная перепроверка поддержки (кнопка «Проверить снова»); true — API появился */
  recheckSupport: () => boolean;
}

export interface PrintCanvasOptions {
  dither?: "steinberg" | "bayer" | "atkinson" | "none";
  brightness?: number;
  intensity?: number;
}

/* ------------------------------------------------------------------ */
/* Поддержка Web Bluetooth — живая проверка                            */
/* ------------------------------------------------------------------ */

/** Нужен сам API и метод requestDevice() */
function rawBtSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const bt = (navigator as { bluetooth?: { requestDevice?: unknown } }).bluetooth;
  return typeof bt?.requestDevice === "function";
}

/** URL-параметр диагностики/тестов; безопасно при отсутствии window */
function urlHas(name: string): boolean {
  try {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
}

/** ?nobt=1 — диагностика/демо: имитирует браузер без Web Bluetooth */
function nobtPinned(): boolean {
  return urlHas("nobt");
}

const PrinterContext = createContext<PrinterContextValue | null>(null);

export function PrinterProvider({
  children,
  t,
}: {
  children: React.ReactNode;
  /** Переводчик приходит ЧЕРЕЗ ПРОПС от корня страницы (см. AppRoot) */
  t: Translator;
}) {
  const clientRef = useRef<ThermalPrinterClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("pc.notConnected");
  const [printerState, setPrinterState] = useState<PrinterState | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [notMxw01Hint, setNotMxw01Hint] = useState(false);

  /* --- Поддержка Web Bluetooth: живая, а не разовая -------------------
   * Safari, Firefox и ВСЕ обычные браузеры iOS/iPadOS не имеют Web
   * Bluetooth — печатать оттуда невозможно (см. BleWarningDialog).
   * Но API может ПОЯВИТЬСЯ уже после загрузки страницы: beacio (Safari
   * Web Extension) инжектирует navigator.bluetooth, когда пользователь
   * включит расширение и разрешит доступ к сайтам. Поэтому поддержка —
   * состояние с опросом (1 с) и перепроверкой по фокусу/возврату на
   * вкладку, а не одноразовая проверка при монтировании.
   *
   * Диагностика/тесты (URL-параметры):
   *  • ?nobt=1 — жёсткий пин «Web Bluetooth нет» (проверка плашки);
   *  • ?nobt=1&fakebt=<мс> — имитация beacio: через <мс> после загрузки
   *    в navigator добавляется фейковый bluetooth, опрос его подхватывает
   *    и статус «unsupported» снимается сам (плашка закрывается). */

  const [supported, setSupported] = useState<boolean>(
    () => !nobtPinned() && rawBtSupported()
  );

  useEffect(() => {
    const fakebt = urlHas("fakebt");
    if (nobtPinned() && !fakebt) return; // пин: Web Bluetooth «отсутствует»
    let fakeTimer: ReturnType<typeof setTimeout> | undefined;
    if (fakebt) {
      let delay = 3000;
      try {
        delay = Math.max(0, Number(new URLSearchParams(window.location.search).get("fakebt")) || 3000);
      } catch {
        /* нет location — дефолтная задержка */
      }
      fakeTimer = setTimeout(() => {
        try {
          Object.defineProperty(navigator, "bluetooth", {
            value: { requestDevice: async () => ({}) },
            configurable: true,
          });
        } catch {
          /* тест-режим: не смогли инжектировать — не критично */
        }
      }, delay);
    }
    const check = () => setSupported(rawBtSupported());
    check();
    const iv = setInterval(check, 1000);
    // Возврат на вкладку (включали расширение в Настройках) — мгновенная перепроверка
    const onChange = () => check();
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("pageshow", onChange);
    return () => {
      clearInterval(iv);
      if (fakeTimer) clearTimeout(fakeTimer);
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("pageshow", onChange);
    };
  }, []);

  useEffect(() => {
    if (!supported) {
      setStatus("unsupported");
      setStatusMessage("pc.unsupported");
      return;
    }
    /* Web Bluetooth появился (например, включили beacio на лету) —
     * снимаем «unsupported», не трогая активные процессы подключения */
    setStatus((prev) => (prev === "unsupported" ? "disconnected" : prev));
    setStatusMessage((prev) => (prev === "pc.unsupported" ? "pc.notConnected" : prev));
  }, [supported]);

  /** Ручная перепроверка (кнопка «Проверить снова»): true — API есть.
   *  Пин ?nobt=1 действует и здесь (диагностический режим честный);
   *  исключение — режим fakebt, где имитируется позднее появление API. */
  const recheckSupport = useCallback((): boolean => {
    const ok = nobtPinned() && !urlHas("fakebt") ? false : rawBtSupported();
    setSupported(ok);
    return ok;
  }, []);

  const ensureClient = useCallback((): ThermalPrinterClient => {
    if (!clientRef.current) {
      // Драйвер создаётся в каноническом виде: адаптер + клиент, без настроек.
      clientRef.current = new ThermalPrinterClient(new WebBluetoothAdapter());
    }
    return clientRef.current;
  }, []);

  const attachListeners = useCallback((client: ThermalPrinterClient) => {
    client.on("connected", (event) => {
      setDeviceName(event.device?.name ?? "MXW01");
    });
    client.on("disconnected", () => {
      setStatus("disconnected");
      setStatusMessage("pc.disconnected");
      setPrinterState(null);
      setDeviceName(null);
    });
    client.on("stateChange", (event) => {
      setPrinterState(event.state);
    });
    client.on("error", (event) => {
      setLastError(event.error?.message ?? t("pc.unknownError"));
    });
  }, [t]);

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "connected") return;
    setLastError(null);
    setNotMxw01Hint(false);
    setStatus("connecting");
    setStatusMessage("common.connecting");
    try {
      const client = ensureClient();
      attachListeners(client);
      await client.connect();
      setStatus("connected");
      setStatusMessage("pc.connected");
    } catch (e) {
      const raw = (e as Error)?.message ?? String(e);
      /* Драйвер падает ПОСЛЕ открытия GATT (статус-запрос без ответа) —
       * разрываем «полуподключение», чтобы не занимать слот принтера */
      try {
        await clientRef.current?.disconnect();
      } catch {
        /* уже разорвано */
      }
      clientRef.current = null;
      setStatus("disconnected");
      setStatusMessage("pc.connectFailed");
      if (NOT_MXW01_RE.test(raw)) {
        /* v1.0.62: вместо сырого «Timeout waiting for notification 0xa1» —
         * понятная подсказка + баннер с переключением на MX10 (cat) */
        setNotMxw01Hint(true);
        setLastError(t("pc.maybeCatHint"));
        throw new Error(t("pc.maybeCatHint"));
      }
      setLastError(raw);
      throw e;
    }
  }, [attachListeners, ensureClient, status, t]);

  const disconnect = useCallback(async () => {
    const client = clientRef.current;
    if (client) {
      try {
        await client.disconnect();
      } catch {
        /* игнорируем — соединение уже разорвано */
      }
    }
    clientRef.current = null;
    setStatus(supported ? "disconnected" : "unsupported");
    setStatusMessage("pc.notConnected");
    setPrinterState(null);
    setDeviceName(null);
    setNotMxw01Hint(false);
  }, [supported]);

  const printCanvas = useCallback(
    async (canvas: HTMLCanvasElement, opts?: PrintCanvasOptions) => {
      const client = clientRef.current;
      if (!client || !client.isConnected) {
        throw new Error(t("pc.notConnected"));
      }
      setStatus("printing");
      setStatusMessage("pc.sending");
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error(t("pc.canvasUnavailable"));
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Стандартные параметры печати (как в примерах драйвера).
        // «none» (без дизеринга) маппится в «threshold» драйвера — жёсткий
        // ч/б порог, визуально = печать без дизеринга. Драйвер не изменён.
        await client.print(imageData, {
          dither:
            opts?.dither === "none" ? "threshold" : (opts?.dither ?? "steinberg"),
          brightness: opts?.brightness ?? 128,
          intensity: opts?.intensity ?? 93,
        });
        setStatus("connected");
        setStatusMessage("pc.done");
      } catch (e) {
        setStatus("connected");
        setStatusMessage("common.printError");
        const raw = (e as Error)?.message ?? String(e);
        if (NOT_MXW01_RE.test(raw)) {
          /* v1.0.62: принтер подключён, но молчит — подсказка про cat */
          setNotMxw01Hint(true);
          setLastError(t("pc.maybeCatHint"));
          throw new Error(t("pc.maybeCatHint"));
        }
        setLastError(raw);
        throw e;
      }
    },
    [t]
  );

  const value = useMemo<PrinterContextValue>(
    () => ({
      status,
      supported,
      deviceName,
      statusMessage,
      printerState,
      lastError,
      notMxw01Hint,
      connect,
      disconnect,
      printCanvas,
      recheckSupport,
    }),
    [status, supported, deviceName, statusMessage, printerState, lastError, notMxw01Hint, connect, disconnect, printCanvas, recheckSupport]
  );

  return <PrinterContext.Provider value={value}>{children}</PrinterContext.Provider>;
}

export function usePrinter(): PrinterContextValue {
  const ctx = useContext(PrinterContext);
  if (!ctx) throw new Error("usePrinter must be used within PrinterProvider");
  return ctx;
}
