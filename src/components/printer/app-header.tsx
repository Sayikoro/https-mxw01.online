"use client";
/**
 * Шапка приложения: логотип и название, выпадающий список типа принтера
 * рядом с кнопкой подключения (v1.0.35), статус принтера и «Настройки»:
 *  • тип принтера: Bluetooth (MXW01) / HPRT — BT-этикетки (v1.0.55) /
 *    MX10 — cat-протокол (v1.0.61, оранжевый) /
 *    POS-USB (ESC/POS) — кнопка «Подключить» меняет иконку и цвет
 *    (зелёный / фиолетовый / оранжевый / синий); у HPRT — настройки носителя
 *    (linerless/gap) и «Диагностика Bluetooth» (raw-консоль, сервисы GATT);
 *  • язык (компактные бейджи RU/EN) и «Сохранить офлайн-версию»;
 *  • тема: светлая / тёмная / системная;
 *  • качество превью: Быстрое (1×) / Точное (4×);
 *  • этикетка (длина ленты) — общий контрол со вкладками;
 *  • печать по USB: инверсия цветов канваса (v1.0.38, ESC/POS и TSPL) —
 *    раздел виден только с включённым POS (v1.0.48, «Экспериментально»);
 *  • «Экспериментально» (v1.0.48): свитч «Поддержка POS (Beta)» включает
 *    весь POS-функционал (тип «POS-USB», USB-настройки, POS-диагностика);
 *  • обслуживание: тестовая страница и счётчик ленты (примерный расчёт);
 *  • бэкап/восстановление — перенесены сюда из шапки (v1.0.35);
 *  • версия строкой + «Изменения по версиям» (versions.md с сайта) +
 *    «Проверить обновления» (PWA);
 *  • диагностика подключения;
 *  • «Сбросить всё» — двухшаговое подтверждение в самом конце.
 *  (Liquid Glass удалён в v1.0.39 — искажение фона ломало меню настроек.)
 */
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { usePrinter } from "@/lib/printer/printer-context";
import { plural } from "@/lib/printer/i18n";
import { useUsbPrinter } from "@/lib/printer/usb/usb-printer-context";
import { useHprtPrinter } from "@/lib/printer/hprt/hprt-printer-context";
import { useCatPrinter } from "@/lib/printer/cat/cat-printer-context";
import { usbPosHeadDots, USB_POS_MAX_PRINT_MM } from "@/lib/printer/usb/raster";
import { useTheme, applyTheme } from "@/lib/printer/theme";
import type { ThemeSetting } from "@/lib/printer/theme";
import { usePosFlag } from "@/lib/printer/pos-flag";
import { usePreviewQuality } from "@/lib/printer/preview-quality";
import type { PreviewQuality } from "@/lib/printer/preview-quality";
import { APP_VERSION, GITHUB_REPO, absoluteUrl } from "@/lib/printer/site";
import type { Lang, Translator } from "@/lib/printer/i18n";
import { BleWarningDialog } from "./ble-warning";
import { ChangelogDialog } from "./changelog-dialog";
import { GameDialog } from "./game-dialog";
import { LogoMark } from "./logo";
import { HprtDiagnosticsDialog } from "./hprt-diagnostics";
import { OfflineSaveManager, OFFLINE_SAVE_EVENT } from "./offline-save";
import { LabelSizeControl } from "./shell";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { renderTestPage } from "@/lib/printer/tools-render";
import { resetTapeCounter, useTapeCounter, notePrintedMm } from "@/lib/printer/tape-counter";
import { PX_PER_MM } from "@/lib/printer/types";
import { resetAllData, downloadBackup, restoreBackupFromFile } from "@/lib/printer/backup";
import {
  BluetoothConnected,
  Bluetooth,
  BluetoothOff,
  Cat,
  Check,
  CheckCircle2,
  ChevronDown,
  DatabaseBackup,
  Download,
  ExternalLink,
  FileCheck2,
  HardDriveDownload,
  History,
  Loader2,
  Monitor,
  Moon,
  Printer,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Sun,
  Trash2,
  Upload,
  Usb,
  X,
} from "lucide-react";

/** Числовое поле (мм) — то же оформление, что в PrintDock (shell.tsx) */
const NUM_CLS =
  "h-7 w-14 rounded-md border border-slate-200 bg-white px-1 text-xs font-medium tabular-nums text-slate-700 shadow-xs outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

/** Длина ленты для человека: «3 м 42 см» / «42 см» */
function tapeSpentText(mm: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (!(mm > 0)) return `0 ${t("unit.cm")}`;
  const totalCm = Math.round(mm / 10);
  const m = Math.floor(totalCm / 100);
  const cm = totalCm % 100;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m} ${t("unit.m")}`);
  if (cm > 0 || m === 0) parts.push(`${cm} ${t("unit.cm")}`);
  return parts.join(" ");
}

/** Компактная кнопка-бейдж выбора (язык / тема / качество превью) */
function ChoiceBadge({
  active,
  title,
  onClick,
  children,
  testid,
}: {
  active: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testid}
      title={title}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3 text-xs font-semibold transition-colors",
        active
          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Выпадающий список типа принтера (v1.0.35): Bluetooth (MXW01), HPRT —
 * BT-этикетки (v1.0.55), MX10 — cat-протокол (v1.0.61) или POS-USB
 * (ESC/POS). Выбор меняет транспорт печати (mxw01-transport); кнопка
 * «Подключить» рядом подстраивает иконку и цвет: BT — зелёная, HPRT —
 * фиолетовая, MX10 (cat) — оранжевая, POS — синяя. В браузерах без
 * WebUSB вариант POS-USB недоступен. У HPRT в подвале списка — вход в
 * «Диагностику Bluetooth» (подбор GATT-профиля под реальный принтер).
 * - Экспериментальный POS (v1.0.48): тип «POS-USB» виден ТОЛЬКО при
 *   включённом свитче «Поддержка POS (Beta)» в Настройках. -
 */
function TransportSelect({
  t,
  onConnectAll,
  onOpenDiagnostics,
}: {
  t: Translator;
  onConnectAll: (allDevices?: boolean) => void | Promise<void>;
  onOpenDiagnostics: () => void;
}) {
  const usb = useUsbPrinter();
  const hprt = useHprtPrinter();
  const { posEnabled } = usePosFlag();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* Закрытие по клику мимо списка и по Escape */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options: {
    value: "ble" | "usb" | "hprt" | "cat";
    icon: React.ReactNode;
    label: string;
    desc: string;
    disabled: boolean;
  }[] = [
    {
      value: "ble",
      icon: <Bluetooth className="h-4 w-4" />,
      label: t("dock.typeBle"),
      desc: t("dock.typeBleDesc"),
      disabled: false,
    },
    // - HPRT (v1.0.55): этикеточный принтер по Bluetooth (T260LR) —
    //   обычный транспорт, без экспериментального флага -
    {
      value: "hprt",
      icon: <Printer className="h-4 w-4" />,
      label: t("dock.typeHprt"),
      desc: t("dock.typeHprtDesc"),
      disabled: false,
    },
    // - MX10 (v1.0.61): «котиковый» cat-протокол (порт thermy) —
    //   MX10/MX*/GB03 и родственные дешёвые принтеры -
    {
      value: "cat",
      icon: <Cat className="h-4 w-4" />,
      label: t("dock.typeCat"),
      desc: t("dock.typeCatDesc"),
      disabled: false,
    },
    // - POS скрыт за экспериментальным флагом: без свитча в Настройках
    //   весь POS-функционал недоступен (v1.0.48) -
    ...(posEnabled
      ? [
          {
            value: "usb" as const,
            icon: <Usb className="h-4 w-4" />,
            label: t("dock.typeUsb"),
            desc: t("dock.typeUsbDesc"),
            disabled: !usb.supported,
          },
        ]
      : []),
  ];
  const current = options.find((o) => o.value === usb.transport) ?? options[0];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        data-testid="transport-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("dock.typeAria")}
        title={t("dock.typeAria")}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 max-w-[190px] items-center gap-1.5 rounded-full border border-slate-200 bg-white py-0 pl-2.5 pr-2 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <span
          className={cn(
            "shrink-0",
            usb.transport === "usb"
              ? "text-blue-600 dark:text-blue-400"
              : usb.transport === "hprt"
                ? "text-violet-600 dark:text-violet-400"
                : usb.transport === "cat"
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-green-600 dark:text-green-400"
          )}
        >
          {current.icon}
        </span>
        <span className="truncate">{current.label}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("dock.typeAria")}
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/50"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={usb.transport === o.value}
              data-testid={`transport-${o.value}`}
              disabled={o.disabled}
              onClick={() => {
                usb.setTransport(o.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 aria-selected:bg-slate-100 dark:hover:bg-slate-800 dark:aria-selected:bg-slate-800"
            >
              <span
                className={cn(
                  "shrink-0",
                  o.value === "usb"
                    ? "text-blue-600 dark:text-blue-400"
                    : o.value === "hprt"
                      ? "text-violet-600 dark:text-violet-400"
                      : "text-green-600 dark:text-green-400"
                )}
              >
                {o.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {o.label}
                </span>
                <span className="block truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">
                  {o.desc}
                </span>
              </span>
              {usb.transport === o.value && (
                <Check className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-300" />
              )}
            </button>
          ))}
          {usb.transport === "usb" && usb.supported && (
            <div className="mt-1 border-t border-slate-100 px-2.5 pb-0.5 pt-1.5 dark:border-slate-800">
              <button
                type="button"
                data-testid="usb-connect-all"
                onClick={() => {
                  setOpen(false);
                  void onConnectAll(true);
                }}
                className="text-[11px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300"
              >
                {t("usb.chooseAll")}
              </button>
            </div>
          )}
          {usb.transport === "hprt" && (
            <div className="mt-1 border-t border-slate-100 px-2.5 pb-0.5 pt-1.5 dark:border-slate-800">
              <button
                type="button"
                data-testid="hprt-open-diagnostics"
                onClick={() => {
                  setOpen(false);
                  onOpenDiagnostics();
                }}
                className="text-[11px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300"
              >
                {t("set.hprtDiagnostics")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type UpdatesState = "idle" | "checking" | "ok" | "ready" | "new" | "dev" | "fail";

/* Мастер самообновления (v1.0.59): состояние панели /update на хостинге */
type PanelState = "unknown" | "probing" | "ready" | "setup" | "old" | "missing";
type UpdPhase = "idle" | "auth" | "installing" | "done";

/* Панель с Git-кнопкой (git_install) появилась в 1.0.58 — это минимальная
   версия, которой мастер доверяет установку */
const PANEL_MIN_VERSION = "1.0.58";
/* Пароль панели обновлений хранится ТОЛЬКО по явной галочке «запомнить»
   и только в этом браузере; в UI никогда не показывается */
const PANEL_PASS_KEY = "mxw01.updpass";

/** CSRF-токен панели из скрытого поля формы */
function extractCsrf(html: string): string | null {
  const m = html.match(/name="csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

/** Flash-сообщение панели (POST → redirect → GET) */
function extractFlash(html: string): { kind: "ok" | "err"; text: string } | null {
  const m = html.match(/class="flash (ok|err)">([^<]*)</);
  return m ? { kind: m[1] as "ok" | "err", text: m[2] } : null;
}

/** Сравнение версий по числовым сегментам: "1.2.10" > "1.2.9" */
function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((s) => parseInt(s, 10) || 0);
  const b = current.split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function AppHeader({
  t,
  lang,
  setLang,
}: {
  /** Переводчик — через пропсы из AppRoot (текст живёт в src/locales) */
  t: Translator;
  lang: Lang;
  setLang: (l: Lang) => void;
}) {
  const { status, deviceName, statusMessage, printerState, lastError, notMxw01Hint, connect, disconnect, printCanvas } =
    usePrinter();
  const usb = useUsbPrinter();
  const hprt = useHprtPrinter();
  const cat = useCatPrinter();
  const { posEnabled, setPosEnabled: writePosFlag } = usePosFlag();
  const { theme, setTheme } = useTheme();
  const { quality, setPreviewQuality } = usePreviewQuality();
  const { toast } = useToast();
  // v1.0.45: печатная ширина головки POS (BP21: 54 мм · 203/25.4 = 432 точки);
  // BLE (MXW01) плотность считает по-прежнему — это только USB-показ
  const headDots = usbPosHeadDots(usb.dpi);
  const [connecting, setConnecting] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [testPrinting, setTestPrinting] = useState(false);
  const tapeCounter = useTapeCounter();
  const [changelogOpen, setChangelogOpen] = useState(false);
  /* Диагностика Bluetooth (HPRT): вход из списка принтера и из Настроек */
  const [hprtDiagOpen, setHprtDiagOpen] = useState(false);
  /* Чей транспорт показывает Диагностика Bluetooth: hprt или cat (MX10, v1.0.63) */
  const [diagSource, setDiagSource] = useState<"hprt" | "cat">("hprt");
  /* Секретная мини-игра: 5 тапов по версии с паузой не более 2.5 с между ними */
  const [gameOpen, setGameOpen] = useState(false);
  const versionClicksRef = useRef({ n: 0, last: 0 });
  const onVersionClick = () => {
    const now = Date.now();
    const st = versionClicksRef.current;
    if (now - st.last > 2500) st.n = 0;
    st.last = now;
    st.n += 1;
    if (st.n >= 5) {
      st.n = 0;
      setGameOpen(true);
    }
  };
  const [updates, setUpdates] = useState<UpdatesState>("idle");
  /* Версия, найденная на GitHub (состояние "new") */
  const [newVer, setNewVer] = useState("");
  /* Мастер самообновления: состояние панели /update и фазы установки */
  const [panel, setPanel] = useState<PanelState>("unknown");
  const [updPhase, setUpdPhase] = useState<UpdPhase>("idle");
  const [updMsg, setUpdMsg] = useState("");
  const [panelPass, setPanelPass] = useState("");
  const [panelPass2, setPanelPass2] = useState("");
  const [rememberPass, setRememberPass] = useState(true);
  const [needPass, setNeedPass] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);

  /* Тема: класс на <html> уже ставит инлайн-скрипт до отрисовки; эффект
     синхронизирует состояние хранилища (например, смена темы ОС) */
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /* «Сбросить всё»: авто-снятие подтверждения через 6 секунд */
  useEffect(() => {
    if (!resetArmed) return;
    const timer = window.setTimeout(() => setResetArmed(false), 6000);
    return () => window.clearTimeout(timer);
  }, [resetArmed]);

  /* Предупреждение «это не MXW01, а котиковый принтер» (v1.0.62): появляется
   * после таймаута статуса, закрывается крестиком и сбрасывается сам */
  const [catHintClosed, setCatHintClosed] = useState(false);
  useEffect(() => {
    if (!notMxw01Hint) setCatHintClosed(false);
  }, [notMxw01Hint]);
  /** Переключение на cat прямо из баннера: клик — уже user gesture,
   * так что можно сразу открыть диалог Bluetooth */
  const handleSwitchToCat = async () => {
    setCatHintClosed(true);
    /* Разорвать MXW01-соединение: иначе клиент остаётся подписанным на
     * нотификации и занимает слот котикового принтера */
    try {
      await disconnect();
    } catch {
      /* уже разорвано */
    }
    usb.setTransport("cat");
    try {
      await cat.connect();
    } catch {
      /* ошибки подключения видны в чипе/тосте cat-транспорта */
    }
  };

  /* Предупреждение: браузер без Web Bluetooth */
  const [bleManual, setBleManual] = useState(false);
  const [bleClosed, setBleClosed] = useState(false);
  const bleOpen = (status === "unsupported" && !bleClosed) || bleManual;

  const handleBleOpenChange = (v: boolean) => {
    setBleManual(v);
    if (!v) setBleClosed(true);
  };

  // Вкладки просят открыть предупреждение (печать без Web Bluetooth)
  useEffect(() => {
    const openWarn = () => setBleManual(true);
    window.addEventListener("mxw01:ble-warning", openWarn);
    return () => window.removeEventListener("mxw01:ble-warning", openWarn);
  }, []);

  /* Web Bluetooth появился (например, пользователь включил beacio) —
   * подтверждаем тостом: плашка закроется, кнопка станет «Подключить» */
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "unsupported" && status !== "unsupported") {
      toast({ title: t("ble.foundTitle"), description: t("ble.foundDesc") });
    }
    prevStatusRef.current = status;
  }, [status, t, toast]);

  const handleConnect = async () => {
    if (status === "unsupported") {
      setBleManual(true);
      return;
    }
    setConnecting(true);
    try {
      await connect();
    } catch {
      /* ошибка уже отражена в статусе */
    } finally {
      setConnecting(false);
    }
  };

  /** Подключение USB-принтера (POS): ошибки — готовым переводом в тосте */
  const handleConnectUsb = async (allDevices = false) => {
    try {
      await usb.connect(allDevices);
    } catch (e) {
      toast({
        title: (e as Error)?.message ?? t("usb.err.cancelled"),
        variant: "destructive",
      });
    }
  };

  /** Кнопка «Подключить»: путь зависит от выбранного типа принтера */
  const handleConnectClick = async () => {
    // - HPRT (v1.0.55): этикеточный принтер по Bluetooth, свой контекст -
    if (usb.transport === "hprt") {
      if (!hprt.supported || hprt.status === "connecting") return;
      try {
        await hprt.connect();
      } catch (e) {
        toast({
          title: (e as Error)?.message ?? t("hprt.err.connectFailed"),
          variant: "destructive",
        });
      }
      return;
    }
    // - MX10 (v1.0.61): cat-протокол по Bluetooth, свой контекст -
    if (usb.transport === "cat") {
      if (!cat.supported || cat.status === "connecting") return;
      try {
        await cat.connect();
      } catch (e) {
        toast({
          title: (e as Error)?.message ?? t("cat.err.connectFailed"),
          variant: "destructive",
        });
      }
      return;
    }
    if (usb.transport === "usb") {
      if (!usb.supported || usb.connecting) return;
      await handleConnectUsb(false);
      return;
    }
    await handleConnect();
  };

  const handleBackupDownload = () => {
    try {
      const name = downloadBackup();
      toast({ title: t("header.backupDownloaded"), description: name });
    } catch {
      toast({ title: t("header.backupFailed"), variant: "destructive" });
    }
  };

  const handleBackupRestore = async (file: File) => {
    try {
      const restored = await restoreBackupFromFile(file);
      if (!restored.length) {
        toast({
          title: t("header.backupEmpty"),
          description: t("header.backupEmptyDesc"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("header.restored"),
        description: t("header.restoredDesc"),
      });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast({
        title: t("header.restoreFailed"),
        description: (e as Error)?.message ?? t("header.restoreFailedDesc"),
        variant: "destructive",
      });
    }
  };

  /* Тестовая страница: генерируется на стороне приложения и печатается
     штатным printCanvas; драйвер не изменяется */
  const handleTestPage = async () => {
    if (status === "unsupported") {
      setBleManual(true);
      return;
    }
    setTestPrinting(true);
    try {
      const { canvas } = renderTestPage();
      /* v1.0.63: тест-страница печатает АКТИВНЫМ транспортом (как вкладки
       * ленты/ценников) — раньше она всегда шла через MXW01, и пользователь
       * с MX10 получал «не ответил на команды MXW01» прямо из Настроек */
      const transport = usb.transport;
      if (transport === "cat") {
        await cat.printCanvas(canvas); // сам подключит при необходимости
      } else if (transport === "hprt") {
        await hprt.printCanvas(canvas);
      } else if (transport === "usb") {
        await usb.printCanvas(canvas);
      } else {
        if (status !== "connected") {
          toast({ title: t("common.connecting") });
          await connect();
        }
        await printCanvas(canvas);
      }
      notePrintedMm(canvas.height / PX_PER_MM);
      toast({ title: t("it.printSent") });
    } catch (e) {
      toast({
        title: t("common.printError"),
        description: (e as Error)?.message ?? undefined,
        variant: "destructive",
      });
    } finally {
      setTestPrinting(false);
    }
  };

  /* «Проверить обновления» (v1.0.57, мастер с v1.0.59): (1) спрашивает
     releases/latest у GitHub-репозитория проекта (GITHUB_REPO в
     src/lib/printer/site.ts) — если релиз новее установленной версии,
     переходим в состояние "new": дальше подключается мастер самообновления
     (проверяет панель /update на хостинге и ставит обновление сам);
     (2) если релиза нет — обновляет service worker: если SW реально
     обновился, применяет новую версию с перезагрузкой (SW ставит
     skipWaiting при install); если версия не менялась — «последняя версия»
     без сброса страницы (v1.0.60).
     Без PWA (dev-режим, офлайн-копия) — честное сообщение. */
  const handleCheckUpdates = async () => {
    setUpdates("checking");
    setNewVer("");
    /* Релиз на GitHub новее установленной версии? Работает и в dev,
       и в офлайн-копии; приватный репозиторий вернёт 404 — молча пропускаем. */
    if (GITHUB_REPO) {
      try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
        });
        if (res.ok) {
          const j = (await res.json()) as { tag_name?: string };
          const ver = (j.tag_name ?? "").replace(/^v/i, "");
          if (ver && isNewerVersion(ver, APP_VERSION)) {
            setNewVer(ver);
            setUpdates("new");
            return; /* сайт ещё не менялся — перезагрузка не нужна */
          }
        }
      } catch {
        /* GitHub недоступен — остаётся SW-проверка */
      }
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      setUpdates("dev");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setUpdates("dev");
        return;
      }
      /* v1.0.60: перезагружаем страницу ТОЛЬКО если SW реально обновился
         (updatefound / waiting). Раньше reload был безусловным — страница
         сбрасывалась даже при актуальной версии. */
      let updated = false;
      const onUpdateFound = () => {
        updated = true;
      };
      reg.addEventListener("updatefound", onUpdateFound);
      try {
        await reg.update();
      } finally {
        reg.removeEventListener("updatefound", onUpdateFound);
      }
      if (updated || reg.waiting) {
        setUpdates("ready");
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setUpdates("ok");
      }
    } catch {
      setUpdates("fail");
    }
  };

  /* ------- Мастер самообновления (v1.0.59): сайт ставит обновление сам ------- */

  /** Опрос панели /update: готова ли к Git-обновлению (по версии в футере) */
  const probePanel = async (): Promise<{ state: PanelState; html: string }> => {
    let html = "";
    try {
      const res = await fetch("/update/", { cache: "no-store" });
      html = res.ok ? await res.text() : "";
    } catch {
      html = "";
    }
    if (!html) return { state: "missing", html: "" };
    if (/name="action" value="setup"/.test(html)) return { state: "setup", html };
    const vm = html.match(/MXW01 updater v([0-9.]+)/);
    if (vm && !isNewerVersion(PANEL_MIN_VERSION, vm[1])) return { state: "ready", html };
    return { state: "old", html };
  };

  /** Повторный опрос панели (кнопка «Проверить снова») */
  const reprobePanel = async () => {
    setPanel("probing");
    setUpdMsg("");
    const r = await probePanel();
    setPanel(r.state);
    setNeedPass(r.state === "ready" && /name="action" value="login"/.test(r.html));
  };

  /* Появился новый релиз → сразу опрашиваем панель и подтягиваем
     запомненный пароль (он никогда не показывается в UI) */
  useEffect(() => {
    if (updates !== "new") return;
    let dead = false;
    setPanel("probing");
    setUpdPhase("idle");
    setUpdMsg("");
    const run = async () => {
      try {
        const p = localStorage.getItem(PANEL_PASS_KEY);
        if (p && !dead) setPanelPass(p);
      } catch { /* приватный режим */ }
      const r = await probePanel();
      if (dead) return;
      setPanel(r.state);
      setNeedPass(/name="action" value="login"/.test(r.html));
    };
    void run();
    return () => {
      dead = true;
    };
  }, [updates]);

  /** POST-форма в панель (fetch следует за redirect — возвращается HTML со flash) */
  const postPanelForm = async (data: Record<string, string>): Promise<string> => {
    const res = await fetch("/update/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data).toString(),
      cache: "no-store",
    });
    return res.text();
  };

  /** Самообновление: вход в панель → git_install (кит с GitHub → копия → установка) */
  const runSelfUpdate = async () => {
    setUpdMsg("");
    try {
      /* 1. Свежая страница панели: CSRF + какая форма перед нами */
      setUpdPhase("auth");
      const res = await fetch("/update/", { cache: "no-store" });
      if (!res.ok) throw new Error(t("set.updPanelMissing"));
      let html = await res.text();
      let csrf = extractCsrf(html);
      if (!csrf) throw new Error(t("set.updPanelOld"));
      /* 1а. Панель ещё без пароля — создаём его прямо из мастера */
      if (/name="action" value="setup"/.test(html)) {
        if (panelPass.length < 6) throw new Error(t("set.updPassShort"));
        if (panelPass !== panelPass2) throw new Error(t("set.updPassMismatch"));
        html = await postPanelForm({ csrf, action: "setup", password: panelPass, password2: panelPass2 });
        csrf = extractCsrf(html) ?? csrf;
      }
      /* 1б. Вход по паролю (если панель его спрашивает) */
      if (/name="action" value="login"/.test(html)) {
        html = await postPanelForm({ csrf, action: "login", password: panelPass });
        const fl = extractFlash(html);
        if ((fl && fl.kind === "err") || /name="action" value="login"/.test(html)) {
          throw new Error(t("set.updWrongPass"));
        }
        csrf = extractCsrf(html) ?? csrf;
      }
      /* 2. Установка одной кнопкой: кит с GitHub → резервная копия → распаковка */
      setUpdPhase("installing");
      try {
        if (rememberPass && panelPass) localStorage.setItem(PANEL_PASS_KEY, panelPass);
        if (!rememberPass) localStorage.removeItem(PANEL_PASS_KEY);
      } catch { /* приватный режим */ }
      html = await postPanelForm({ csrf, action: "git_install" });
      const fl2 = extractFlash(html);
      if (fl2 && fl2.kind === "err") throw new Error(fl2.text);
      if (!(fl2 && fl2.kind === "ok" && fl2.text.includes("Обновлено с GitHub"))) {
        throw new Error(t("set.updNoConfirm"));
      }
      /* 3. Готово: подтягиваем новый service worker и перезагружаемся */
      setUpdPhase("done");
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.update();
      } catch { /* не PWA — просто перезагрузка */ }
      setTimeout(() => window.location.reload(), 1800);
    } catch (e) {
      setUpdPhase("idle");
      setUpdMsg((e as Error)?.message || t("set.updatesFail"));
    }
  };

  /* «Сбросить всё»: первый клик — подтверждение (6 с), второй — удаление
     всех данных терминала в этом браузере и перезагрузка. Согласие на
     аналитику не трогается. */
  const handleResetAll = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    resetAllData();
    toast({ title: t("set.resetAllDone") });
    setTimeout(() => window.location.reload(), 600);
  };

  const bleConnected = usb.transport === "ble" && (status === "connected" || status === "printing");
  const usbConnected = usb.transport === "usb" && usb.hasDevice;
  const hprtConnected =
    usb.transport === "hprt" && (hprt.status === "connected" || hprt.status === "printing");
  // - MX10 (v1.0.61): свой чип статуса в оранжевой гамме -
  const catConnected =
    usb.transport === "cat" && (cat.status === "connected" || cat.status === "printing");

  const themeOptions: { value: ThemeSetting; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: t("set.themeLight"), icon: <Sun className="h-3.5 w-3.5" /> },
    { value: "dark", label: t("set.themeDark"), icon: <Moon className="h-3.5 w-3.5" /> },
    { value: "system", label: t("set.themeSystem"), icon: <Monitor className="h-3.5 w-3.5" /> },
  ];

  const qualityOptions: { value: PreviewQuality; label: string }[] = [
    { value: "fast", label: t("set.qualityFast") },
    { value: "exact", label: t("set.qualityExact") },
  ];

  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex h-14 items-center justify-between gap-2 px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <LogoMark className="h-7 w-7 shrink-0" />
          <h1 className="truncate text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t("header.title")}
          </h1>
          <span className="hidden truncate text-xs text-slate-400 lg:inline dark:text-slate-500">
            {t(statusMessage)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Тип принтера: Bluetooth (MXW01) / HPRT (BT-этикетки) / POS-USB —
              кнопка «Подключить» рядом меняет иконку и цвет */}
          <TransportSelect
            t={t}
            onConnectAll={handleConnectUsb}
            onOpenDiagnostics={() => { setDiagSource("hprt"); setHprtDiagOpen(true); }}
          />

          {bleConnected ? (
            <>
              <span
                className="flex h-7 items-center gap-1.5 rounded-full bg-green-500 px-3 text-xs font-semibold text-white shadow-sm shadow-green-500/30"
                title={deviceName ?? "MXW01"}
              >
                <BluetoothConnected className="h-3.5 w-3.5" />
                {deviceName ?? "MXW01"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                title={t("header.disconnect")}
                onClick={() => disconnect()}
              >
                <BluetoothOff className="h-4 w-4" />
              </Button>
            </>
          ) : usbConnected ? (
            <>
              <span
                className="flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm shadow-blue-600/30"
                title={usb.deviceName ?? ""}
              >
                <Usb className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[140px] truncate">{usb.deviceName}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                title={t("usb.disconnectAria")}
                onClick={() => void usb.disconnect()}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : hprtConnected ? (
            <>
              <span
                className="flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-violet-600 px-3 text-xs font-semibold text-white shadow-sm shadow-violet-600/30"
                title={hprt.deviceName ?? ""}
              >
                <Printer className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[140px] truncate">{hprt.deviceName}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                title={t("header.disconnect")}
                onClick={() => void hprt.disconnect()}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : catConnected ? (
            <>
              <span
                className="flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-orange-600 px-3 text-xs font-semibold text-white shadow-sm shadow-orange-600/30"
                title={cat.deviceName ?? ""}
              >
                <Cat className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[140px] truncate">{cat.deviceName}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                title={t("header.disconnect")}
                onClick={() => void cat.disconnect()}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              onClick={handleConnectClick}
              disabled={
                connecting ||
                (usb.transport === "usb" && (usb.connecting || !usb.supported)) ||
                (usb.transport === "hprt" && (hprt.status === "connecting" || !hprt.supported)) ||
                (usb.transport === "cat" && (cat.status === "connecting" || !cat.supported))
              }
              data-testid={
                usb.transport === "usb"
                  ? "usb-connect"
                  : usb.transport === "hprt"
                    ? "hprt-connect"
                    : usb.transport === "cat"
                      ? "cat-connect"
                      : "ble-connect"
              }
              title={
                usb.transport === "usb" && !usb.supported
                  ? t("usb.unsupported")
                  : usb.transport === "hprt" && !hprt.supported
                    ? t("hprt.unsupported")
                    : usb.transport === "cat" && !cat.supported
                      ? t("cat.unsupported")
                      : undefined
              }
              className={cn(
                "h-8 gap-1.5 rounded-full px-3.5 text-xs font-medium text-white shadow-sm",
                usb.transport === "usb"
                  ? "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
                  : usb.transport === "hprt"
                    ? "bg-violet-600 hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-700"
                    : usb.transport === "cat"
                      ? "bg-orange-600 hover:bg-orange-700 dark:bg-orange-600 dark:hover:bg-orange-700"
                      : "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
              )}
            >
              {connecting || usb.connecting || hprt.status === "connecting" || cat.status === "connecting" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : usb.transport === "usb" ? (
                <Usb className="h-3.5 w-3.5" />
              ) : usb.transport === "hprt" ? (
                <Printer className="h-3.5 w-3.5" />
              ) : usb.transport === "cat" ? (
                <Cat className="h-3.5 w-3.5" />
              ) : (
                <Bluetooth className="h-3.5 w-3.5" />
              )}
              {usb.transport === "usb"
                ? usb.supported
                  ? t("header.connect")
                  : t("usb.noWebUsb")
                : usb.transport === "hprt"
                  ? hprt.supported
                    ? t("header.connect")
                    : t("header.noBluetooth")
                  : usb.transport === "cat"
                    ? cat.supported
                      ? t("header.connect")
                      : t("header.noBluetooth")
                    : status === "unsupported"
                      ? t("header.noBluetooth")
                      : t("header.connect")}
            </Button>
          )}

          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                title={t("header.settings")}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("header.settings")}</DialogTitle>
              </DialogHeader>

              {/* Язык интерфейса: компактные бейджи RU/EN (полное имя — в
                  подсказке и скринридерам) */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.lang")}
                </div>
                <div className="flex items-center gap-2">
                  {([
                    { code: "ru" as Lang, label: "RU", name: "Русский" },
                    { code: "en" as Lang, label: "EN", name: "English" },
                  ]).map(({ code, label, name }) => (
                    <ChoiceBadge
                      key={code}
                      active={lang === code}
                      title={name}
                      onClick={() => setLang(code)}
                    >
                      {label}
                    </ChoiceBadge>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full gap-1.5 rounded-lg text-xs font-medium"
                  onClick={() => window.dispatchEvent(new CustomEvent(OFFLINE_SAVE_EVENT))}
                >
                  <HardDriveDownload className="h-3.5 w-3.5" />
                  {t("set.saveOffline")}
                </Button>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800" />

              {/* Тема оформления: светлая / тёмная / системная */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.theme")}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {themeOptions.map(({ value, label, icon }) => (
                    <ChoiceBadge
                      key={value}
                      active={theme === value}
                      title={label}
                      onClick={() => setTheme(value)}
                      testid={`theme-${value}`}
                    >
                      <span className="flex items-center gap-1">
                        {icon}
                        {label}
                      </span>
                    </ChoiceBadge>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800" />

              {/* Качество превью: печать и сохранение всегда в полном 4× */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.quality")}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {qualityOptions.map(({ value, label }) => (
                    <ChoiceBadge
                      key={value}
                      active={quality === value}
                      title={label}
                      onClick={() => setPreviewQuality(value)}
                      testid={`quality-${value}`}
                    >
                      {label}
                    </ChoiceBadge>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("set.qualityHint")}
                </p>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800" />

              {/* Высота этикетки (длина ленты) — общий контрол со вкладками */}
              <LabelSizeControl t={t} />

              {/* — Экспериментально (v1.0.48): opt-in функции. Свитч включает
                  ВЕСЬ POS-функционал: тип «POS-USB» в списке принтера,
                  USB-настройки и POS-диагностику — без него приложение
                  работает только с MXW01 по Bluetooth — */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.experimentalTitle")}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("set.posBeta")}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {posEnabled ? t("common.enabled") : t("common.disabled")}
                    </div>
                  </div>
                  <Switch
                    checked={posEnabled}
                    data-testid="pos-beta"
                    aria-label={t("set.posBeta")}
                    onCheckedChange={(v) => {
                      // - Выключение: транспорт «usb» недоступен — уводим на BLE,
                      //   чтобы кнопка «Печать» не осталась на скрытом транспорте -
                      writePosFlag(v);
                      if (!v && usb.transport === "usb") usb.setTransport("ble");
                    }}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("set.posBetaHint")}
                </p>
              </div>

              {posEnabled && (
                <>
                  <div className="border-t border-slate-200 dark:border-slate-800" />

                  {/* Печать по USB: инверсия цветов канваса (v1.0.38) — негатив
                      применяется к растру перед отправкой (ESC/POS и TSPL);
                      выравнивание по левому краю — всегда, без настройки */}
                  <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.printUsbTitle")}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("set.usbInvert")}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {usb.invert ? t("set.usbInvertOn") : t("set.usbInvertOff")}
                    </div>
                  </div>
                  <Switch
                    checked={usb.invert}
                    data-testid="usb-invert"
                    aria-label={t("set.usbInvert")}
                    onCheckedChange={(v) => usb.setInvert(v)}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("set.usbInvertHint")}
                </p>
                {/* Разрешение печати (v1.0.43): DPI головки — пресеты 203/300/600.
                    Влияет на растеризацию TSPL (точек на мм); ESC/POS подгоняет
                    растр под ширину головки независимо от DPI */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("usb.dpi")}
                    </div>
                    <div className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                      {usb.dpi} dpi · {(usb.dpi / 25.4).toFixed(1)} {t("usb.dotsMm")}
                    </div>
                    {/* v1.0.45: печатная ширина из спецификации BP21 — 54 мм × dpi/25.4 */}
                    <div
                      className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500"
                      data-testid="usb-head-dots"
                    >
                      {t("usb.headDots")}: {headDots}{' '}
                      {plural(lang, headDots, ["точка", "точки", "точек"], ["dot", "dots"])} ·{' '}
                      {USB_POS_MAX_PRINT_MM} {t("usb.mm")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {[203, 300, 600].map((v) => (
                      <ChoiceBadge
                        key={v}
                        active={usb.dpi === v}
                        title={`${v} dpi`}
                        onClick={() => usb.setDpi(v)}
                        testid={`usb-dpi-${v}`}
                      >
                        {v}
                      </ChoiceBadge>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("usb.dpiHint")}
                </p>
                  </div>
                </>
              )}

              {/* — HPRT (v1.0.55): этикеточный принтер по Bluetooth (T260LR).
                  Носитель linerless (рулон без подложки) по умолчанию,
                  переключение на этикетки с зазором; язык команд TSPL/ESC-POS;
                  «Диагностика Bluetooth» — подбор GATT-профиля и raw-консоль — */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.hprtTitle")}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("set.hprtMedia")}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {hprt.media === "continuous" ? t("hprt.mediaLinerless") : t("hprt.mediaGap")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ChoiceBadge
                      active={hprt.media === "continuous"}
                      title={t("hprt.mediaLinerless")}
                      onClick={() => hprt.setMedia("continuous")}
                      testid="hprt-media-continuous"
                    >
                      {t("hprt.mediaLinerless")}
                    </ChoiceBadge>
                    <ChoiceBadge
                      active={hprt.media === "gap"}
                      title={t("hprt.mediaGap")}
                      onClick={() => hprt.setMedia("gap")}
                      testid="hprt-media-gap"
                    >
                      {t("hprt.mediaGap")}
                    </ChoiceBadge>
                  </div>
                </div>
                {/* Размер этикетки (мм): ширина больше печатной зоны головки
                    (48 мм = 384 точки) энкодер сам зажмёт при печати */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0 text-xs font-medium text-slate-700 dark:text-slate-200">
                    {t("hprt.labelSize")}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                    <input
                      type="number"
                      min={15}
                      max={120}
                      value={hprt.labelW}
                      data-testid="hprt-label-w"
                      aria-label={t("hprt.labelSizeW")}
                      onChange={(e) => hprt.setLabelW(Number(e.target.value))}
                      className={NUM_CLS}
                    />
                    ×
                    <input
                      type="number"
                      min={10}
                      max={300}
                      value={hprt.labelH}
                      data-testid="hprt-label-h"
                      aria-label={t("hprt.labelSizeH")}
                      onChange={(e) => hprt.setLabelH(Number(e.target.value))}
                      className={NUM_CLS}
                    />
                    <span>mm</span>
                  </div>
                </div>
                {hprt.media === "gap" && (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                    <div className="min-w-0 text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("usb.gap")}
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={hprt.gapMm}
                      data-testid="hprt-gap"
                      aria-label={t("usb.gap")}
                      onChange={(e) => hprt.setGapMm(Number(e.target.value))}
                      className={NUM_CLS}
                    />
                  </div>
                )}
                {/* Язык команд: TSPL (этикетки, по умолчанию) / ESC/POS (чеки) */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0 text-xs font-medium text-slate-700 dark:text-slate-200">
                    {t("hprt.protocol")}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ChoiceBadge
                      active={hprt.protocol === "tspl"}
                      title="TSPL"
                      onClick={() => hprt.setProtocol("tspl")}
                      testid="hprt-protocol-tspl"
                    >
                      TSPL
                    </ChoiceBadge>
                    <ChoiceBadge
                      active={hprt.protocol === "escpos"}
                      title="ESC/POS"
                      onClick={() => hprt.setProtocol("escpos")}
                      testid="hprt-protocol-escpos"
                    >
                      ESC/POS
                    </ChoiceBadge>
                  </div>
                </div>
                {/* Плотность TSPL 0…15 (больше — темнее) */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0 text-xs font-medium text-slate-700 dark:text-slate-200">
                    {t("hprt.density")}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {[6, 8, 10, 12].map((v) => (
                      <ChoiceBadge
                        key={v}
                        active={hprt.density === v}
                        title={`${t("hprt.density")} ${v}`}
                        onClick={() => hprt.setDensity(v)}
                        testid={`hprt-density-${v}`}
                      >
                        {v}
                      </ChoiceBadge>
                    ))}
                  </div>
                </div>
                {/* Инверсия канваса — как у POS-USB (негатив перед бинаризацией) */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("hprt.invert")}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {hprt.invert ? t("set.usbInvertOn") : t("set.usbInvertOff")}
                    </div>
                  </div>
                  <Switch
                    checked={hprt.invert}
                    data-testid="hprt-invert"
                    aria-label={t("hprt.invert")}
                    onCheckedChange={(v) => hprt.setInvert(v)}
                  />
                </div>
                {/* Чёткая печать: гамма-усиление до бинаризации (v1.0.41) */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("hprt.hq")}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {hprt.hq ? t("common.enabled") : t("common.disabled")}
                    </div>
                  </div>
                  <Switch
                    checked={hprt.hq}
                    data-testid="hprt-hq"
                    aria-label={t("hprt.hq")}
                    onCheckedChange={(v) => hprt.setHq(v)}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="hprt-diagnostics-open"
                  className="h-8 w-full gap-1.5 rounded-lg text-xs font-medium"
                  onClick={() => { setDiagSource("hprt"); setHprtDiagOpen(true); }}
                >
                  <Printer className="h-3.5 w-3.5" />
                  {t("set.hprtDiagnostics")}
                </Button>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("set.hprtUsbHint")}
                </p>
              </div>

              {/* — MX10 (v1.0.61): cat-протокол (порт thermy). Скорость и
                  энергия — как в print_defaults thermy; диагностика — та же
                  raw-консоль, что у HPRT — */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.catTitle")}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("cat.speed")}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {t("cat.speedHint")}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={127}
                    value={cat.speed}
                    data-testid="cat-speed"
                    aria-label={t("cat.speed")}
                    onChange={(e) => cat.setSpeed(Number(e.target.value))}
                    className={NUM_CLS}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("cat.energy")}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {t("cat.energyHint")}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={1000}
                    max={15000}
                    step={250}
                    value={cat.energy}
                    data-testid="cat-energy"
                    aria-label={t("cat.energy")}
                    onChange={(e) => cat.setEnergy(Number(e.target.value))}
                    className={NUM_CLS}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {t("cat.extraFeed")}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {t("cat.extraFeedHint")}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={cat.extraFeed}
                    data-testid="cat-feed"
                    aria-label={t("cat.extraFeed")}
                    onChange={(e) => cat.setExtraFeed(Number(e.target.value))}
                    className={NUM_CLS}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="cat-diagnostics-open"
                  className="h-8 w-full gap-1.5 rounded-lg text-xs font-medium"
                  onClick={() => { setDiagSource("cat"); setHprtDiagOpen(true); }}
                >
                  <Cat className="h-3.5 w-3.5" />
                  {t("set.catDiagnostics")}
                </Button>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("set.catHint")}
                </p>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800" />

              {/* Обслуживание: тестовая страница и счётчик ленты */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.maintTitle")}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="test-page"
                  className="h-8 w-full gap-1.5 rounded-lg text-xs font-medium"
                  disabled={testPrinting || status === "printing"}
                  onClick={() => void handleTestPage()}
                >
                  {testPrinting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileCheck2 className="h-3.5 w-3.5" />
                  )}
                  {t("set.testPage")}
                </Button>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("set.testPageHint")}
                </p>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">{t("set.tapeSpent")}</div>
                    <div className="truncate text-sm font-medium tabular-nums">
                      {tapeSpentText(tapeCounter.totalMm, t)}
                      {tapeCounter.sessionMm > 0 && (
                        <span className="ml-1 text-xs font-normal text-slate-400 dark:text-slate-500">
                          {t("set.tapeSpentSession", { amount: tapeSpentText(tapeCounter.sessionMm, t) })}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {t("set.tapeApprox")}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    title={t("set.tapeReset")}
                    onClick={() => {
                      resetTapeCounter();
                      toast({ title: t("set.tapeResetDone") });
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800" />

              {/* Версия строкой + история версий + проверка обновлений */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    data-testid="app-version"
                    className="flex min-w-0 cursor-pointer select-none items-center gap-1.5 text-xs tabular-nums text-slate-400 dark:text-slate-500"
                    onClick={onVersionClick}
                  >
                    v{APP_VERSION}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="changelog-open"
                      className="h-7 gap-1.5 rounded-lg text-xs font-medium"
                      onClick={() => setChangelogOpen(true)}
                    >
                      <History className="h-3.5 w-3.5" />
                      {t("set.changelog")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="check-updates"
                      className="h-7 gap-1.5 rounded-lg text-xs font-medium"
                      disabled={updates === "checking"}
                      onClick={() => void handleCheckUpdates()}
                    >
                      {updates === "checking" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      {t("set.checkUpdates")}
                    </Button>
                  </div>
                </div>
                {updates !== "idle" && updates !== "checking" && (
                  <p
                    data-testid="updates-status"
                    className={cn(
                      "text-[11px] leading-relaxed",
                      updates === "fail"
                        ? "text-red-500"
                        : updates === "new"
                          ? "text-orange-600 dark:text-orange-400"
                          : "text-slate-400 dark:text-slate-500"
                    )}
                  >
                    {updates === "new"
                      ? t("set.updatesNew", { ver: newVer })
                      : t(
                          updates === "ok"
                            ? "set.updatesOk"
                            : updates === "ready"
                              ? "set.updatesReady"
                              : updates === "dev"
                                ? "set.updatesDev"
                                : "set.updatesFail"
                        )}
                  </p>
                )}
                {/* Мастер самообновления (v1.0.59): ставит обновление сам через панель /update */}
                {updates === "new" && (
                  <div
                    data-testid="update-wizard"
                    className="space-y-2 rounded-lg border border-orange-500/30 bg-orange-500/5 p-2.5"
                  >
                    {panel === "probing" || panel === "unknown" ? (
                      <p className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("set.updProbing")}
                      </p>
                    ) : panel === "ready" || panel === "setup" ? (
                      <>
                        {panel === "setup" && (
                          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {t("set.updSetupHint")}
                          </p>
                        )}
                        {(needPass || panel === "setup") && (
                          <div className="space-y-1.5">
                            <input
                              data-testid="upd-pass"
                              type="password"
                              value={panelPass}
                              onChange={(e) => setPanelPass(e.target.value)}
                              placeholder={t("set.updPass")}
                              autoComplete="off"
                              className="h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-orange-400 dark:border-slate-600 dark:bg-slate-900"
                            />
                            {panel === "setup" && (
                              <input
                                data-testid="upd-pass2"
                                type="password"
                                value={panelPass2}
                                onChange={(e) => setPanelPass2(e.target.value)}
                                placeholder={t("set.updPass2")}
                                autoComplete="off"
                                className="h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-orange-400 dark:border-slate-600 dark:bg-slate-900"
                              />
                            )}
                            {panel === "ready" && (
                              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                <input
                                  type="checkbox"
                                  checked={rememberPass}
                                  onChange={(e) => setRememberPass(e.target.checked)}
                                  className="h-3 w-3 accent-orange-500"
                                />
                                {t("set.updRemember")}
                              </label>
                            )}
                          </div>
                        )}
                        {updPhase !== "done" && (
                          <Button
                            data-testid="upd-install"
                            size="sm"
                            className="h-7 w-full gap-1.5 rounded-lg text-xs font-semibold"
                            disabled={updPhase === "auth" || updPhase === "installing"}
                            onClick={() => void runSelfUpdate()}
                          >
                            {updPhase === "auth" || updPhase === "installing" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            {updPhase === "auth"
                              ? t("set.updPhaseLogin")
                              : updPhase === "installing"
                                ? t("set.updPhaseInstall")
                                : t("set.updInstall", { ver: newVer })}
                          </Button>
                        )}
                        {updPhase === "done" && (
                          <p
                            data-testid="upd-done"
                            className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t("set.updPhaseDone")}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {panel === "missing" ? t("set.updPanelMissing") : t("set.updPanelOld")}
                        </p>
                        <a
                          data-testid="upd-kit-link"
                          href={`https://github.com/${GITHUB_REPO}/releases/latest/download/mxw01-deploy-kit.zip`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600 hover:underline dark:text-orange-400"
                        >
                          <Download className="h-3 w-3" />
                          {t("set.updKitLink")}
                        </a>
                        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {t("set.updPanelHow")}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="upd-reprobe"
                          className="h-7 gap-1.5 rounded-lg text-xs font-medium"
                          onClick={() => void reprobePanel()}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {t("set.updReprobe")}
                        </Button>
                      </>
                    )}
                    {updMsg && (
                      <p data-testid="upd-error" className="text-[11px] leading-relaxed text-red-500">
                        {updMsg}
                      </p>
                    )}
                  </div>
                )}
                {updates === "new" && (
                  <a
                    data-testid="updates-panel-link"
                    href="/update/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600 hover:underline dark:text-orange-400"
                  >
                    {t("set.updatesOpen")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {/* Разработчик: Telegram для связи (v1.0.58) */}
                <a
                  data-testid="developer-link"
                  href="https://t.me/The_Sovereign_o_f_Dawn"
                  target="_blank"
                  rel="noreferrer"
                  title={t("set.developerHint")}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                >
                  <Send className="h-3 w-3" />
                  {t("set.developer")}:
                  <span className="tabular-nums">@The_Sovereign_o_f_Dawn</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800" />

              {/* Диагностика подключения */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("header.diagnostics")}
                </div>
                <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                  <span className="text-muted-foreground">Web Bluetooth</span>
                  <span className="font-medium">
                    {status === "unsupported" ? t("diag.webbtNo") : t("diag.webbtOk")}
                  </span>
                </div>
                {posEnabled && usb.transport === "usb" ? (
                  <>
                    {/* v1.0.41: для активного USB-подключения — WebUSB-строки */}
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.driver")}</span>
                      <span className="font-medium">{t("diag.driverWebusb")}</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.transport")}</span>
                      <span className="font-medium">{t("diag.transportUsb")}</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.usbLang")}</span>
                      <span className="font-medium">
                        {usb.lang === "tspl" ? t("usb.langTspl") : t("usb.langEscpos")}
                      </span>
                    </div>
                    {/* v1.0.43: разрешение головки — фактический DPI печати */}
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.usbDpi")}</span>
                      <span className="font-medium tabular-nums" data-testid="diag-usb-dpi">
                        {usb.dpi} dpi
                      </span>
                    </div>
                    {/* v1.0.45: печатная ширина головки POS — 54 мм × dpi/25.4
                        (BP21 при 203 dpi → 432 точки); BLE считает по-прежнему */}
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.usbHead")}</span>
                      <span className="font-medium tabular-nums" data-testid="diag-usb-head">
                        {headDots} {plural(lang, headDots, ["точка", "точки", "точек"], ["dot", "dots"])} ·{' '}
                        {USB_POS_MAX_PRINT_MM} {t("usb.mm")}
                      </span>
                    </div>
                    {usb.lang === "tspl" ? (
                      <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                        <span className="text-muted-foreground">{t("diag.usbLabel")}</span>
                        {/* v1.0.46: у непрерывной ленты зазор не используется */}
                        <span className="font-medium tabular-nums">
                          {usb.labelW} × {usb.labelH} mm ·{" "}
                          {usb.media === "continuous"
                            ? t("usb.mediaCont").toLowerCase()
                            : `${t("usb.gap").toLowerCase()} ${usb.gapMm} mm`}
                        </span>
                      </div>
                    ) : (
                      <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                        <span className="text-muted-foreground">{t("diag.usbPaper")}</span>
                        <span className="font-medium">
                          {usb.paperWidth === 384
                            ? t("usb.width58")
                            : usb.paperWidth === 576
                              ? t("usb.width80")
                              : t("usb.width80w")}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.device")}</span>
                      <span className="font-medium">{usb.deviceName ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.status")}</span>
                      <span className="font-medium">
                        {usb.printing
                          ? t("diag.usbPrinting")
                          : usb.hasDevice
                            ? t("diag.usbConnected")
                            : t("diag.usbNotConnected")}
                      </span>
                    </div>
                  </>
                ) : usb.transport === "hprt" ? (
                  <>
                    {/* v1.0.55: HPRT — Web Bluetooth, GATT-профиль, настройки */}
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.driver")}</span>
                      <span className="font-medium">{t("diag.hprtDriver")}</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.transport")}</span>
                      <span className="font-medium">{t("diag.hprtTransport")}</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.hprtProfile")}</span>
                      <span
                        className="max-w-[55%] truncate text-right font-medium"
                        title={hprt.profile?.name ?? ""}
                      >
                        {hprt.profile?.name ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.device")}</span>
                      <span className="font-medium">{hprt.deviceName ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.usbLabel")}</span>
                      <span className="font-medium tabular-nums">
                        {hprt.labelW} × {hprt.labelH} mm ·{" "}
                        {hprt.media === "continuous"
                          ? t("usb.mediaCont").toLowerCase()
                          : `${t("usb.gap").toLowerCase()} ${hprt.gapMm} mm`}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.status")}</span>
                      <span className="font-medium">
                        {hprt.status === "printing"
                          ? t("diag.usbPrinting")
                          : hprt.status === "connected"
                            ? t("diag.usbConnected")
                            : t("diag.usbNotConnected")}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.driver")}</span>
                      <span className="font-medium">mxw01-thermal-printer v0.1.0</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.transport")}</span>
                      <span className="font-medium">Web Bluetooth LE (service ae30)</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.device")}</span>
                      <span className="font-medium">{deviceName ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-4 rounded-lg bg-muted p-2.5">
                      <span className="text-muted-foreground">{t("diag.status")}</span>
                      <span className="font-medium">{status}</span>
                    </div>
                  </>
                )}
                {lastError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                    {t("diag.lastErrorPrefix")} {lastError}
                  </div>
                )}
                {printerState && (
                  <pre className="max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                    {JSON.stringify(printerState, null, 2)}
                  </pre>
                )}
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800" />

              {/* Бэкап и восстановление: перенесены из шапки в настройки
                  (v1.0.35); все данные редакторов живут в localStorage */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("set.backupTitle")}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="backup-download"
                    title={t("header.backupDownload")}
                    className="h-8 min-w-0 flex-1 gap-1.5 rounded-lg text-xs font-medium"
                    onClick={handleBackupDownload}
                  >
                    <DatabaseBackup className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t("set.backupSave")}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="backup-restore"
                    title={t("header.restore")}
                    className="h-8 min-w-0 flex-1 gap-1.5 rounded-lg text-xs font-medium"
                    onClick={() => restoreInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t("set.backupRestore")}</span>
                  </Button>
                </div>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleBackupRestore(f);
                    e.target.value = "";
                  }}
                />
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("set.backupHint")}
                </p>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800" />

              {/* Сбросить всё: двухшаговое подтверждение, в самом конце */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="reset-all"
                  className={cn(
                    "h-8 w-full gap-1.5 rounded-lg text-xs font-medium",
                    resetArmed &&
                      "border-red-300 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
                  )}
                  onClick={handleResetAll}
                >
                  {resetArmed ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  {resetArmed ? t("set.resetAllConfirm") : t("set.resetAll")}
                </Button>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("set.resetAllHint")}
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* v1.0.62: «Похоже, это MX10/GB03» — после таймаута статуса MXW01.
          Показываем на BLE-транспорте, пока пользователь не закрыл подсказку */}
      {notMxw01Hint && usb.transport === "ble" && !catHintClosed && (
        <div
          data-testid="cat-hint-banner"
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 md:px-4 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <Cat className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <p className="min-w-0 flex-1 leading-relaxed">{t("pc.maybeCatBanner")}</p>
          <Button
            size="sm"
            data-testid="cat-hint-switch"
            className="h-7 shrink-0 gap-1.5 rounded-full bg-orange-600 px-3 text-xs font-medium text-white shadow-sm hover:bg-orange-700 dark:bg-orange-600 dark:hover:bg-orange-700"
            onClick={() => void handleSwitchToCat()}
          >
            <Cat className="h-3.5 w-3.5" />
            {t("pc.maybeCatSwitch")}
          </Button>
          <button
            type="button"
            data-testid="cat-hint-close"
            aria-label={t("pc.maybeCatClose")}
            title={t("pc.maybeCatClose")}
            className="shrink-0 rounded-full p-1 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/50 dark:hover:text-amber-300"
            onClick={() => setCatHintClosed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Предупреждение: браузер без Web Bluetooth */}
      <BleWarningDialog t={t} open={bleOpen} onOpenChange={handleBleOpenChange} />
      {/* История версий: versions.md с сайта */}
      <ChangelogDialog t={t} open={changelogOpen} onOpenChange={setChangelogOpen} />
      <GameDialog t={t} open={gameOpen} onOpenChange={setGameOpen} />
      {/* Диагностика Bluetooth (HPRT): сервисы GATT, raw-консоль, тест-этикетка */}
      <HprtDiagnosticsDialog t={t} open={hprtDiagOpen} onOpenChange={setHprtDiagOpen} source={diagSource} />
      {/* Ctrl/Cmd+S на сайте → диалог скачивания офлайн-версии */}
      <OfflineSaveManager t={t} />
    </header>
  );
}
