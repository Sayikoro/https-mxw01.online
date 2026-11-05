"use client";
/**
 * ============================================================================
 *  КОНТЕКСТ CAT-ПЕЧАТИ (MX10 и родственные принтеры по Bluetooth).
 * ============================================================================
 *  Четвёртый транспорт (v1.0.61) рядом с BLE (MXW01), HPRT и POS-USB:
 *    1. протокол — cat-protocol.ts (порт проверенного thermy: кадры
 *       51 78 …, CRC-8 poly 0x07, решётка BITMAP 0xa2, 384 точки);
 *    2. BLE-транспорт — переиспользован HprtBleTransport (автопрофиль GATT
 *       по известным сервисам AE00/FF00/AB00…, чанки, паузы, журнал);
 *    3. printCanvas(canvas) — тот же ч/б конвейер, что у POS-USB/HPRT
 *       (бинарный холст → ресемпл до 384 точек → обрезка пустых полей →
 *       задание cat: prepare + строки + finish);
 *    4. настройки в localStorage (mxw01-cat-*): скорость, энергия, прогон,
 *       размер чанка и пауза (диагностика).
 *  Ошибки бросаются как Error с ГОТОВЫМ переводом (t()) — вкладки просто
 *  показывают e.message в тосте (как в hprt/usb-printer-context).
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
  type BleProfileInfo,
  type DiscoveredService,
} from "@/lib/printer/hprt/ble-transport";
import {
  isBinaryRgba,
  resampleBinary,
  trimBlankRows,
} from "@/lib/printer/usb/raster";
import {
  buildCatJob,
  CAT_ENERGY_DEFAULT,
  CAT_EXTRA_FEED_DEFAULT,
  CAT_SPEED_DEFAULT,
  CAT_WIDTH,
} from "./cat-protocol";

/* ------------------------------- Типы ---------------------------------- */

export type CatStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "printing";

/* --------------------------- localStorage ------------------------------ */

const SPEED_KEY = "mxw01-cat-speed";
const ENERGY_KEY = "mxw01-cat-energy";
const FEED_KEY = "mxw01-cat-feed";
const CHUNK_KEY = "mxw01-cat-chunk";
const DELAY_KEY = "mxw01-cat-delay";

/** Чанк по умолчанию: thermy буферизует кадры до MTU 200 */
const CAT_CHUNK_DEFAULT = 180;
const CAT_DELAY_DEFAULT = 15;

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

function writeLs(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* переполнение — настройка живёт до перезагрузки */
  }
}

/** URL-параметры диагностики (?nobt=1) — как в printer/hprt-контекстах */
function urlHas(name: string): boolean {
  try {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
}

function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return CAT_SPEED_DEFAULT;
  return Math.min(127, Math.max(1, Math.round(n)));
}

function clampEnergy(n: number): number {
  if (!Number.isFinite(n)) return CAT_ENERGY_DEFAULT;
  return Math.min(0xffff, Math.max(1000, Math.round(n)));
}

function clampFeed(n: number): number {
  if (!Number.isFinite(n)) return CAT_EXTRA_FEED_DEFAULT;
  return Math.min(1000, Math.max(0, Math.round(n)));
}

/* ------------------------------ Контекст ------------------------------- */

interface CatPrinterContextValue {
  /** Web Bluetooth доступен (Chrome/Edge/Opera, beacio для Safari) */
  supported: boolean;
  status: CatStatus;
  deviceName: string | null;
  /** Найденный GATT-профиль (после подключения) */
  profile: BleProfileInfo | null;
  lastError: string | null;
  /** Журнал подключения/отправки (последние 400 строк) */
  logs: string[];
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Карта сервисов/характеристик подключённого принтера */
  enumerate: () => Promise<DiscoveredService[]>;
  /** Raw-консоль диагностики: отправить сырые байты */
  sendRaw: (bytes: Uint8Array) => Promise<void>;
  clearLogs: () => void;
  /** Печать canvas; ошибки — Error с готовым переводом */
  printCanvas: (canvas: HTMLCanvasElement, opts?: CatPrintCanvasOptions) => Promise<void>;
  /** Прогресс отправки последней печати 0…1 */
  progress: number;
  /* Настройки */
  speed: number;
  setSpeed: (n: number) => void;
  energy: number;
  setEnergy: (n: number) => void;
  extraFeed: number;
  setExtraFeed: (n: number) => void;
  chunkSize: number;
  setChunkSize: (n: number) => void;
  chunkDelayMs: number;
  setChunkDelayMs: (n: number) => void;
}

export interface CatPrintCanvasOptions {
  /** Прогресс отправки 0…1 */
  onProgress?: (p: number) => void;
}

const CatPrinterContext = createContext<CatPrinterContextValue | null>(null);

export function CatPrinterProvider({
  children,
  t,
}: {
  children: React.ReactNode;
  /** Переводчик приходит ЧЕРЕЗ ПРОПС от корня страницы (см. AppRoot) */
  t: Translator;
}) {
  const transportRef = useRef<HprtBleTransport | null>(null);
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<CatStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [profile, setProfile] = useState<BleProfileInfo | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeedState] = useState(CAT_SPEED_DEFAULT);
  const [energy, setEnergyState] = useState(CAT_ENERGY_DEFAULT);
  const [extraFeed, setExtraFeedState] = useState(CAT_EXTRA_FEED_DEFAULT);
  const [chunkSize, setChunkSizeState] = useState(CAT_CHUNK_DEFAULT);
  const [chunkDelayMs, setChunkDelayMsState] = useState(CAT_DELAY_DEFAULT);
  const printingRef = useRef(false);

  const log = useCallback((line: string) => {
    setLogs((prev) => {
      const next = prev.length >= 400 ? prev.slice(prev.length - 399) : prev.slice();
      next.push(line);
      return next;
    });
  }, []);

  /* --- localStorage и живая проверка Web Bluetooth (после монтирования) ---
   * SSR-разметка детерминирована: supported ставится только после mount. */
  useEffect(() => {
    try {
      setSpeedState(clampSpeed(readLsNumber(SPEED_KEY, CAT_SPEED_DEFAULT)));
      setEnergyState(clampEnergy(readLsNumber(ENERGY_KEY, CAT_ENERGY_DEFAULT)));
      setExtraFeedState(clampFeed(readLsNumber(FEED_KEY, CAT_EXTRA_FEED_DEFAULT)));
      setChunkSizeState(clampChunk(readLsNumber(CHUNK_KEY, CAT_CHUNK_DEFAULT)));
      setChunkDelayMsState(clampDelay(readLsNumber(DELAY_KEY, CAT_DELAY_DEFAULT)));
    } catch {
      /* нет localStorage — дефолты */
    }
    const check = () => setSupported(!urlHas("nobt") && webBluetoothOk());
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
        cancelled: t("cat.err.cancelled"),
        noApi: t("cat.unsupported"),
        noGatt: t("cat.err.connectFailed"),
        noProfile: t("cat.err.noProfile"),
        notConnected: t("cat.err.notConnected"),
        busy: t("cat.err.busy"),
        failed: t("cat.err.transferFailed"),
      };
      return map[key] ?? key;
    },
    [t]
  );

  const connect = useCallback(async () => {
    if (!supported) throw new Error(t("cat.unsupported"));
    if (status === "connecting" || status === "connected" || status === "printing") return;
    setLastError(null);
    setStatus("connecting");
    const tr = ensureTransport();
    try {
      const name = await tr.connect(log);
      setDeviceName(name || "MX10");
      setProfile(tr.profile);
      setStatus("connected");
      log(`${name || "MX10"} — готов к печати (cat-протокол)`);
    } catch (e) {
      setStatus("disconnected");
      if (e instanceof HprtBleError) {
        const msg = translateError(e.key);
        setLastError(msg);
        throw new Error(msg);
      }
      const msg = (e as Error)?.message ?? t("cat.err.connectFailed");
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

  const enumerate = useCallback(async (): Promise<DiscoveredService[]> => {
    const tr = transportRef.current;
    if (!tr) throw new Error(t("cat.err.notConnected"));
    return tr.enumerateServices();
  }, [t]);

  const sendRaw = useCallback(
    async (bytes: Uint8Array) => {
      const tr = transportRef.current;
      if (!tr) throw new Error(t("cat.err.notConnected"));
      await tr.send(bytes, { chunkSize, chunkDelayMs, log });
    },
    [chunkDelayMs, chunkSize, log, t]
  );

  const clearLogs = useCallback(() => setLogs([]), []);

  const printCanvas = useCallback(
    async (canvas: HTMLCanvasElement, opts?: CatPrintCanvasOptions) => {
      if (!supported) throw new Error(t("cat.unsupported"));
      if (printingRef.current) throw new Error(t("cat.err.busy"));
      const tr = ensureTransport();
      // Принтер не подключён — подключаем прямо из этого клика (user gesture)
      if (!tr.isConnected()) {
        await connect();
      }
      const srcCtx = canvas.getContext("2d");
      if (!srcCtx) throw new Error(t("pc.canvasUnavailable"));
      const srcImg = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
      const binary = isBinaryRgba(srcImg.data);
      // Печатная ширина MX10 — CAT_WIDTH точек: бинарный растр ресемплим
      // (box/nearest), полутоновый — канвасом; пустые поля сверху/снизу
      // срезаем (чистый расход ленты), как у HPRT/POS
      let img = binary
        ? resampleBinary(
            { data: srcImg.data, width: srcImg.width, height: srcImg.height },
            CAT_WIDTH
          )
        : rasterizeToWidth(canvas, CAT_WIDTH, t);
      if (binary) {
        img = trimBlankRows(img);
      }
      setStatus("printing");
      printingRef.current = true;
      try {
        const job = buildCatJob(img.data, img.width, img.height, { speed, energy, extraFeed });
        log(`cat: задание ${img.width}×${img.height}, ${job.length} Б (speed ${speed}, energy ${energy})`);
        await tr.send(job, {
          chunkSize,
          chunkDelayMs,
          log,
          onProgress: (p) => {
            setProgress(p);
            opts?.onProgress?.(p);
          },
        });
        setStatus("connected");
        log("cat: задание отправлено");
      } catch (e) {
        setStatus("connected");
        if (e instanceof HprtBleError) {
          const msg = translateError(e.key);
          setLastError(msg);
          throw new Error(msg);
        }
        const msg = (e as Error)?.message ?? t("cat.err.transferFailed");
        setLastError(msg);
        throw new Error(msg);
      } finally {
        printingRef.current = false;
      }
    },
    [chunkDelayMs, chunkSize, connect, energy, ensureTransport, extraFeed, log, speed, supported, t, translateError]
  );

  /* Сеттеры с записью в localStorage */
  const setSpeed = useCallback((n: number) => {
    const v = clampSpeed(n);
    setSpeedState(v);
    writeLs(SPEED_KEY, String(v));
  }, []);
  const setEnergy = useCallback((n: number) => {
    const v = clampEnergy(n);
    setEnergyState(v);
    writeLs(ENERGY_KEY, String(v));
  }, []);
  const setExtraFeed = useCallback((n: number) => {
    const v = clampFeed(n);
    setExtraFeedState(v);
    writeLs(FEED_KEY, String(v));
  }, []);
  const setChunkSize = useCallback((n: number) => {
    const v = clampChunk(n);
    setChunkSizeState(v);
    writeLs(CHUNK_KEY, String(v));
  }, []);
  const setChunkDelayMs = useCallback((n: number) => {
    const v = clampDelay(n);
    setChunkDelayMsState(v);
    writeLs(DELAY_KEY, String(v));
  }, []);

  const value = useMemo<CatPrinterContextValue>(
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
      speed,
      setSpeed,
      energy,
      setEnergy,
      extraFeed,
      setExtraFeed,
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
      speed,
      setSpeed,
      energy,
      setEnergy,
      extraFeed,
      setExtraFeed,
      chunkSize,
      setChunkSize,
      chunkDelayMs,
      setChunkDelayMs,
    ]
  );

  return <CatPrinterContext.Provider value={value}>{children}</CatPrinterContext.Provider>;
}

/* ------------------------------ Хелперы -------------------------------- */

/** Доступ к Web Bluetooth (тот же критерий, что в hprt-транспорте) */
function webBluetoothOk(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    const bt = (navigator as { bluetooth?: { requestDevice?: unknown } }).bluetooth;
    return typeof bt?.requestDevice === "function";
  } catch {
    return false;
  }
}

/** Полутоновый холст → канвас шириной target (как hprt rasterize) */
function rasterizeToWidth(
  canvas: HTMLCanvasElement,
  target: number,
  t: Translator
): { data: Uint8ClampedArray; width: number; height: number } {
  const srcCtx = canvas.getContext("2d");
  if (!srcCtx) throw new Error(t("pc.canvasUnavailable"));
  if (canvas.width === target) {
    const img = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: img.data, width: img.width, height: img.height };
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
  const img = octx.getImageData(0, 0, off.width, off.height);
  return { data: img.data, width: img.width, height: img.height };
}

export function useCatPrinter(): CatPrinterContextValue {
  const ctx = useContext(CatPrinterContext);
  if (!ctx) throw new Error("useCatPrinter must be used within CatPrinterProvider");
  return ctx;
}
