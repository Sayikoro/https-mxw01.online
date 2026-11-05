"use client";
/**
 * ============================================================================
 *  ДИАГНОСТИКА BLUETOOTH — подбор GATT-профиля под реальный принтер (v1.0.55).
 * ============================================================================
 *  HPRT не публикует BLE-профиль T260LR, поэтому транспорт определен по
 *  известным «серийным» профилям. Эта панель закрывает разрыв с реальным
 *  устройством:
 *    • подключение принтера (системный выбор, как у печати);
 *    • карта сервисов/характеристик (uuid + свойства) с копированием;
 *    • raw-консоль: отправка сырых байт (текст или HEX) в найденную
 *      write-характеристику — пробуем ZPL/TSPL/ESC-байты без пересборки;
 *    • тестовая этикетка 384×100 (TSPL-растр штатным printCanvas);
 *    • размер чанка и пауза между чанками (медленным BLE-модулям);
 *    • журнал: подключение, профиль, объём отправки, ответы принтера.
 *  Все строки — через t(); состояние живёт в useHprtPrinter (логи общие).
 * ============================================================================
 */
import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHprtPrinter } from "@/lib/printer/hprt/hprt-printer-context";
import { useCatPrinter } from "@/lib/printer/cat/cat-printer-context";
import { HPRT_CHUNK_MAX, HPRT_CHUNK_MIN, type BleProfileInfo, type DiscoveredService } from "@/lib/printer/hprt/ble-transport";
import type { Translator } from "@/lib/printer/i18n";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  BluetoothConnected,
  Copy,
  Eraser,
  FlaskConical,
  Loader2,
  Play,
  TerminalSquare,
} from "lucide-react";

/** TSPL-пример для raw-консоли: ASCII, строки CRLF (textarea отдаёт \n —
 *  переводим при отправке), TEXT шрифтом «2» — есть на большинстве клонов */
const TSPL_SAMPLE = [
  'SIZE 48 mm,25 mm',
  'GAP 0 mm,0 mm',
  'DIRECTION 1',
  'CLS',
  'TEXT 10,10,"2",0,1,1,"HPRT T260LR"',
  'TEXT 10,50,"2",0,1,1,"Web Terminal"',
  'PRINT 1,1',
  '',
].join("\n");

/** Текст → байты (ASCII; \n → \r\n — TSPL/ESC-команды требуют CRLF).
 *  Посылка всегда заканчивается CRLF: без перевода строки принтер молча
 *  игнорирует последнюю команду (например, «PRINT 1,1» без CRLF). */
function textToBytes(raw: string): Uint8Array | null {
  let normalized = raw.replace(/\r?\n/g, "\r\n");
  if (normalized.length > 0 && !normalized.endsWith("\r\n")) {
    normalized += "\r\n";
  }
  const out = new Uint8Array(normalized.length);
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code > 255) return null; // кириллица и эмодзи в raw не кодируются
    out[i] = code;
  }
  return out;
}

/** HEX-строка («1D 76 30 00», «0x1b», «1b,40») → байты; null — ошибка парсинга */
function hexToBytes(raw: string): Uint8Array | null {
  const clean = raw.replace(/0x/gi, " ").replace(/[,\s]+/g, " ").trim();
  if (!clean) return null;
  const parts = clean.split(" ");
  const out = new Uint8Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    if (!/^[0-9a-f]{1,2}$/i.test(parts[i])) return null;
    out[i] = parseInt(parts[i], 16);
  }
  return out;
}

/**
 * Общий адаптер сессии: один и тот же диалог работает и с HPRT-транспортом,
 * и с cat (MX10) — v1.0.63: раньше логи cat-подключения (профиль ae30,
 * кадры состояния, паузы) не показывались нигде, и «молчащий» принтер
 * было не отладить.
 */
interface DiagSession {
  supported: boolean;
  status: string;
  profile: BleProfileInfo | null;
  logs: string[];
  clearLogs: () => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  enumerate: () => Promise<DiscoveredService[]>;
  sendRaw: (bytes: Uint8Array) => Promise<void>;
  printCanvas: (canvas: HTMLCanvasElement) => Promise<void>;
  chunkSize: number;
  setChunkSize: (n: number) => void;
  chunkDelayMs: number;
  setChunkDelayMs: (n: number) => void;
  unsupportedText: string;
}

export function HprtDiagnosticsDialog({
  t,
  open,
  onOpenChange,
  source = "hprt",
}: {
  t: Translator;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Чей транспорт/журнал показываем: HPRT (по умолчанию) или cat (MX10) */
  source?: "hprt" | "cat";
}) {
  const hprt = useHprtPrinter();
  const cat = useCatPrinter();
  const session: DiagSession =
    source === "cat"
      ? {
          supported: cat.supported,
          status: cat.status,
          profile: cat.profile,
          logs: cat.logs,
          clearLogs: cat.clearLogs,
          connect: cat.connect,
          disconnect: cat.disconnect,
          enumerate: cat.enumerate,
          sendRaw: cat.sendRaw,
          printCanvas: cat.printCanvas,
          chunkSize: cat.chunkSize,
          setChunkSize: cat.setChunkSize,
          chunkDelayMs: cat.chunkDelayMs,
          setChunkDelayMs: cat.setChunkDelayMs,
          unsupportedText: t("cat.unsupported"),
        }
      : {
          supported: hprt.supported,
          status: hprt.status,
          profile: hprt.profile,
          logs: hprt.logs,
          clearLogs: hprt.clearLogs,
          connect: hprt.connect,
          disconnect: hprt.disconnect,
          enumerate: hprt.enumerate,
          sendRaw: hprt.sendRaw,
          printCanvas: hprt.printCanvas,
          chunkSize: hprt.chunkSize,
          setChunkSize: hprt.setChunkSize,
          chunkDelayMs: hprt.chunkDelayMs,
          setChunkDelayMs: hprt.setChunkDelayMs,
          unsupportedText: t("hprt.unsupported"),
        };
  const { toast } = useToast();
  const [hexMode, setHexMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [services, setServices] = useState<DiscoveredService[] | null>(null);
  const [enumerating, setEnumerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  const connected = session.status === "connected" || session.status === "printing";
  const busy = session.status === "connecting" || session.status === "printing";

  const refreshServices = useCallback(async () => {
    setEnumerating(true);
    try {
      setServices(await session.enumerate());
    } catch (e) {
      toast({ title: (e as Error)?.message ?? "?", variant: "destructive" });
    } finally {
      setEnumerating(false);
    }
  }, [session, toast]);

  /* Открытие диалога с уже подключённым принтером — карта сервисов сразу */
  useEffect(() => {
    if (open && connected && services === null) {
      void refreshServices();
    }
  }, [open, connected, refreshServices, services]);

  const handleConnect = useCallback(async () => {
    try {
      await session.connect();
      setServices(null);
    } catch (e) {
      // Отмена выбора устройства — не ошибка, тихо закрываем процесс
      if (!/cancel|выбран/i.test((e as Error)?.message ?? "")) {
        toast({ title: (e as Error)?.message ?? "?", variant: "destructive" });
      }
    }
  }, [session, toast]);

  const handleDisconnect = useCallback(async () => {
    await session.disconnect();
    setServices(null);
  }, [session]);

  const handleSendRaw = useCallback(async () => {
    const bytes = hexMode ? hexToBytes(rawText) : textToBytes(rawText);
    if (!bytes || bytes.length === 0) {
      toast({ title: t("hprt.diag.badPayload"), variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      await session.sendRaw(bytes);
      toast({ title: t("hprt.diag.sent"), description: `${bytes.length} B` });
    } catch (e) {
      toast({ title: (e as Error)?.message ?? "?", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }, [hexMode, rawText, session, t, toast]);

  /** Тестовая этикетка 384×100: рамка + текст + полосы, TSPL-растр 384 точки */
  const handleTestLabel = useCallback(async () => {
    setTesting(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = 100;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(t("pc.canvasUnavailable"));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000000";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t("hprt.diag.testText"), 192, 42);
      ctx.font = "16px monospace";
      ctx.fillText("384 × 100 px", 192, 66);
      for (let i = 0; i < 8; i++) {
        ctx.fillRect(24 + i * 42, 76, 26, 12);
      }
      await session.printCanvas(canvas);
      toast({ title: t("it.printSent") });
    } catch (e) {
      toast({
        title: t("common.printError"),
        description: (e as Error)?.message ?? undefined,
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }, [session, t, toast]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(services, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: t("hprt.diag.copyFailed"), variant: "destructive" });
    }
  }, [services, t, toast]);

  const numCls =
    "h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 shadow-xs outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" data-testid="hprt-diag-dialog">
        <DialogHeader>
          <DialogTitle>{t("hprt.diag.title")}</DialogTitle>
          <DialogDescription>{t("hprt.diag.hint")}</DialogDescription>
        </DialogHeader>

        {/* Подключение */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            data-testid="hprt-diag-connect"
            disabled={busy || (!connected && !session.supported)}
            onClick={() => void (connected ? handleDisconnect() : handleConnect())}
            className={cn(
              "h-8 flex-1 gap-1.5 rounded-lg text-xs font-medium text-white",
              connected ? "bg-violet-600 hover:bg-violet-700" : "bg-slate-900 hover:bg-slate-700"
            )}
          >
            {session.status === "connecting" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BluetoothConnected className="h-3.5 w-3.5" />
            )}
            {connected ? t("hprt.diag.disconnect") : t("hprt.diag.connect")}
          </Button>
          {connected && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="hprt-diag-refresh"
              disabled={enumerating}
              onClick={() => void refreshServices()}
              className="h-8 gap-1.5 rounded-lg text-xs font-medium"
            >
              {enumerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TerminalSquare className="h-3.5 w-3.5" />}
              {t("hprt.diag.refresh")}
            </Button>
          )}
        </div>
        {!session.supported && (
          <p className="text-[11px] text-red-500">{session.unsupportedText}</p>
        )}

        {/* Профиль печати */}
        <div className="rounded-lg bg-muted p-2.5 text-xs" data-testid="hprt-diag-profile">
          <div className="font-semibold text-slate-700 dark:text-slate-200">
            {t("hprt.diag.profile")}: {session.profile?.name ?? t("hprt.diag.profileNone")}
          </div>
          {session.profile && (
            <div className="mt-1 space-y-0.5 font-mono text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
              <div>service: {session.profile.serviceUuid}</div>
              <div>write: {session.profile.writeUuid} ({session.profile.writeWithoutResponse ? "wo/resp" : "w/resp"})</div>
              {session.profile.notifyUuid && <div>notify: {session.profile.notifyUuid}</div>}
            </div>
          )}
        </div>

        {/* Сервисы и характеристики */}
        {services && services.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t("hprt.diag.services")}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="hprt-diag-services-copy"
                onClick={() => void handleCopy()}
                className="h-7 gap-1 rounded-lg px-2 text-[11px] font-medium text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {copied ? <Copy className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? t("hprt.diag.copied") : t("hprt.diag.copy")}
              </Button>
            </div>
            <div
              className="max-h-44 overflow-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[10px] leading-relaxed text-slate-100"
              data-testid="hprt-diag-services"
            >
              {services.map((s) => (
                <div key={s.uuid} className="mb-1.5">
                  <div className="text-emerald-300">service {s.uuid}</div>
                  {s.chars.length === 0 ? (
                    <div className="pl-3 text-slate-500">{t("hprt.diag.noChars")}</div>
                  ) : (
                    s.chars.map((c) => (
                      <div key={c.uuid} className="pl-3">
                        <span className="text-sky-300">char {c.uuid}</span>{" "}
                        <span className="text-amber-300">[{c.props.join(", ")}]</span>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {services !== null && services.length === 0 && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">{t("hprt.diag.servicesEmpty")}</p>
        )}

        {/* Raw-консоль */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("hprt.diag.raw")}
            </div>
            <div className="flex items-center gap-1">
              {(["text", "hex"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={hexMode === (m === "hex")}
                  data-testid={`hprt-diag-format-${m}`}
                  onClick={() => setHexMode(m === "hex")}
                  className={cn(
                    "h-6 rounded-full border px-2 text-[11px] font-semibold transition-colors",
                    hexMode === (m === "hex")
                      ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  )}
                >
                  {m.toUpperCase()}
                </button>
              ))}
              {source === "hprt" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-testid="hprt-diag-template"
                  onClick={() => {
                    setHexMode(false);
                    setRawText(TSPL_SAMPLE);
                  }}
                  className="h-6 rounded-full px-2 text-[11px] font-medium text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  TSPL
                </Button>
              )}
            </div>
          </div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            data-testid="hprt-diag-raw"
            rows={4}
            spellCheck={false}
            placeholder={hexMode ? "1D 76 30 00" : "SIZE 48 mm,25 mm\n…"}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-800 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            {t("hprt.diag.rawHint")}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="hprt-diag-send"
              disabled={!connected || sending || !rawText.trim()}
              onClick={() => void handleSendRaw()}
              className="h-8 flex-1 gap-1.5 rounded-lg text-xs font-medium text-white"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {t("hprt.diag.send")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="hprt-diag-clear-raw"
              onClick={() => setRawText("")}
              className="h-8 gap-1.5 rounded-lg text-xs font-medium"
            >
              <Eraser className="h-3.5 w-3.5" />
              {t("hprt.diag.clearRaw")}
            </Button>
          </div>
        </div>

        {/* Тестовая этикетка */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="hprt-diag-test"
          disabled={!connected || testing}
          onClick={() => void handleTestLabel()}
          className="h-8 w-full gap-1.5 rounded-lg text-xs font-medium"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
          {t("hprt.diag.test")}
        </Button>

        {/* Параметры BLE: чанк и пауза (для медленных модулей) */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-muted p-2.5">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
            {t("hprt.diag.chunk")}
            <select
              value={session.chunkSize}
              data-testid="hprt-diag-chunk"
              onChange={(e) => session.setChunkSize(Number(e.target.value))}
              className={numCls}
            >
              {[20, 52, 64, 100, 180, 512]
                .filter((n) => n >= HPRT_CHUNK_MIN && n <= HPRT_CHUNK_MAX)
                .map((n) => (
                  <option key={n} value={n}>
                    {n} B
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
            {t("hprt.diag.delay")}
            <select
              value={session.chunkDelayMs}
              data-testid="hprt-diag-delay"
              onChange={(e) => session.setChunkDelayMs(Number(e.target.value))}
              className={numCls}
            >
              {[0, 5, 10, 15, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n} ms
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Журнал */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("hprt.diag.log")}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="hprt-diag-log-clear"
              onClick={session.clearLogs}
              className="h-6 gap-1 rounded-lg px-2 text-[11px] font-medium text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <Eraser className="h-3 w-3" />
              {t("hprt.diag.logClear")}
            </Button>
          </div>
          <div
            className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[10px] leading-relaxed text-slate-100"
            data-testid="hprt-diag-log"
          >
            {session.logs.length === 0 ? (
              <span className="text-slate-500">{t("hprt.diag.logEmpty")}</span>
            ) : (
              session.logs.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
