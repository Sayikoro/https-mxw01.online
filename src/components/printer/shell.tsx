"use client";
/**
 * Общий визуальный каркас страницы печати (референс: «Печать ценников»):
 *  • левая белая панель редактора со свёрнутыми секциями и компактными строками;
 *  • правая серая панель предпросмотра с шапкой «Предпросмотр», карточкой
 *    этикетки и закреплённой чёрной кнопкой «Печать».
 *
 * Только UI-слой: на драйвер и отправку печати компоненты не влияют.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Copy,
  Eye,
  Loader2,
  Minus,
  Plus,
  Printer,
  Ruler,
} from "lucide-react";
import type { TextAlignment } from "@/lib/printer/types";
import type { CopiesLayout, CopiesSettings } from "@/lib/printer/copies";
import { COPIES_GAP_OPTIONS, COPIES_MAX, clampCopies } from "@/lib/printer/copies";
import {
  useLabelSize,
  LABEL_MM_PRESETS,
  LABEL_MM_MIN,
  LABEL_MM_MAX,
  clampLabelMm,
  mmToLabelPx,
} from "@/lib/printer/label-size";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Translator } from "@/lib/printer/i18n";
import { usePosFlag } from "@/lib/printer/pos-flag";
import { useUsbPrinter } from "@/lib/printer/usb/usb-printer-context";
import { TSPL_LIMITS } from "@/lib/printer/usb/tspl";

/* ------------------------------------------------------------------ */
/* Панели рабочей области                                              */
/* ------------------------------------------------------------------ */

export function Workspace({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col md:flex-row", className)}>
      {children}
    </div>
  );
}

export function LeftPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
        "md:w-[420px] md:border-b-0 md:border-r md:overflow-y-auto",
        className
      )}
    >
      {children}
    </div>
  );
}

export function RightPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950",
        className
      )}
    >
      {children}
    </div>
  );
}

export function PreviewHeader({
  title,
  actions,
  className,
  t,
}: {
  title?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900",
        className
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <Eye className="h-4 w-4 text-slate-400" />
        {title ?? t("shell.preview")}
      </span>
      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div>
      )}
    </div>
  );
}

export function PreviewBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-h-0 flex-1 md:overflow-y-auto", className)}>
      {children}
    </div>
  );
}

export function ScaleCaption({ text }: { text: string }) {
  return (
    <p className="pb-1 pt-3 text-center text-xs text-slate-400 dark:text-slate-500">
      {text}
    </p>
  );
}

/**
 * Закреплённый внизу блок печати (как на референсе):
 *  • настройки USB-печати — только когда выбран транспорт USB И включён
 *    экспериментальный POS (v1.0.48): язык команд (ESC/POS · чековые /
 *    TSPL · этикетки), для ESC/POS — ширина бумаги (58/80 мм) и авто-отрез,
 *    для TSPL — размеры этикетки/зазор (мм) и кнопка калибровки GAPDETECT;
 *  • выбор типа принтера и подключение — в шапке рядом с кнопкой
 *    «Подключить» (v1.0.35);
 *  • чёрная кнопка «Печать» — путь выбирается по транспорту
 *    (ветка USB реализована в usb-printer-context, BLE — в printer-context;
 *    драйвер MXW01 и printCanvas не изменены).
 */
export function PrintDock({
  onClick,
  disabled,
  loading,
  label,
  className,
  t,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  className?: string;
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
}) {
  const usb = useUsbPrinter();
  const { posEnabled } = usePosFlag();
  // - POS (v1.0.48): без экспериментального флага USB-контролы не показываются
  //   даже если транспорт по какой-то причине остался «usb» -
  const showUsb = usb.supported && usb.transport === "usb" && posEnabled;
  // Калибровка TSPL (GAPDETECT): статус на месте, без тостов —
  // ошибка приходит из usb-контекста уже с готовым переводом
  const [cal, setCal] = React.useState<{
    state: "busy" | "ok" | "err";
    msg?: string;
  } | null>(null);

  const runCalibrate = async () => {
    setCal({ state: "busy" });
    try {
      await usb.calibrate();
      setCal({ state: "ok" });
    } catch (e) {
      setCal({ state: "err", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const selectCls =
    "h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 shadow-xs outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  const numCls =
    "h-7 w-14 rounded-md border border-slate-200 bg-white px-1 text-xs font-medium tabular-nums text-slate-700 shadow-xs outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 shrink-0 bg-slate-100/95 p-3 backdrop-blur md:static dark:bg-slate-950/95",
        className
      )}
    >
      {/* Настройки USB-печати; выбор типа принтера и подключение — в шапке */}
      {showUsb && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <select
              value={usb.lang}
              aria-label={t("usb.langAria")}
              data-testid="usb-lang"
              onChange={(e) => usb.setLang(e.target.value === "tspl" ? "tspl" : "escpos")}
              className={selectCls}
            >
              <option value="escpos">{t("usb.langEscpos")}</option>
              <option value="tspl">{t("usb.langTspl")}</option>
            </select>
            {usb.lang === "escpos" ? (
              <>
                <select
                  value={usb.paperWidth}
                  aria-label={t("usb.widthAria")}
                  data-testid="usb-width"
                  onChange={(e) => usb.setPaperWidth(Number(e.target.value))}
                  className={selectCls}
                >
                  <option value={384}>{t("usb.width58")}</option>
                  <option value={576}>{t("usb.width80")}</option>
                  <option value={640}>{t("usb.width80w")}</option>
                </select>
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={usb.cut}
                    data-testid="usb-cut"
                    onChange={(e) => usb.setCut(e.target.checked)}
                    className="h-3.5 w-3.5 accent-slate-900 dark:accent-slate-100"
                  />
                  {t("usb.cut")}
                </label>
              </>
            ) : (
              <>
                <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("usb.labelW")}
                  <input
                    type="number"
                    min={TSPL_LIMITS.widthMin}
                    max={TSPL_LIMITS.widthMax}
                    value={usb.labelW}
                    aria-label={t("usb.labelWAria")}
                    data-testid="usb-label-w"
                    onChange={(e) => usb.setLabelW(Number(e.target.value))}
                    className={numCls}
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("usb.labelH")}
                  <input
                    type="number"
                    min={TSPL_LIMITS.heightMin}
                    max={TSPL_LIMITS.heightMax}
                    value={usb.labelH}
                    aria-label={t("usb.labelHAria")}
                    data-testid="usb-label-h"
                    onChange={(e) => usb.setLabelH(Number(e.target.value))}
                    className={numCls}
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("usb.gap")}
                  <input
                    type="number"
                    min={TSPL_LIMITS.gapMin}
                    max={TSPL_LIMITS.gapMax}
                    value={usb.gapMm}
                    aria-label={t("usb.gapAria")}
                    data-testid="usb-gap"
                    disabled={usb.media === "continuous"}
                    title={usb.media === "continuous" ? t("usb.mediaHint") : undefined}
                    onChange={(e) => usb.setGapMm(Number(e.target.value))}
                    className={cn(numCls, usb.media === "continuous" && "opacity-50")}
                  />
                </label>
                {/* v1.0.46: тип носителя — непрерывная лента печатает без поиска
                    зазора и без пустого запаса длины (лишняя протяжка ленты) */}
                <select
                  value={usb.media}
                  aria-label={t("usb.mediaAria")}
                  data-testid="usb-media"
                  onChange={(e) => usb.setMedia(e.target.value === "continuous" ? "continuous" : "gap")}
                  className={selectCls}
                >
                  <option value="gap">{t("usb.mediaGap")}</option>
                  <option value="continuous">{t("usb.mediaCont")}</option>
                </select>
                <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("usb.density")}
                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={usb.density}
                    aria-label={t("usb.densityAria")}
                    data-testid="usb-density"
                    onChange={(e) => usb.setDensity(Number(e.target.value))}
                    className={numCls}
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("usb.speed")}
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={usb.speed}
                    aria-label={t("usb.speedAria")}
                    data-testid="usb-speed"
                    onChange={(e) => usb.setSpeed(Number(e.target.value))}
                    className={numCls}
                  />
                </label>
                <button
                  type="button"
                  onClick={runCalibrate}
                  disabled={usb.printing || cal?.state === "busy"}
                  data-testid="usb-calibrate"
                  className="h-7 shrink-0 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-xs outline-none hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {t("usb.calibrate")}
                </button>
              </>
            )}
            <label
              className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
              title={t("usb.hqAria")}
            >
              <input
                type="checkbox"
                checked={usb.hq}
                data-testid="usb-hq"
                onChange={(e) => usb.setHq(e.target.checked)}
                className="h-3.5 w-3.5 accent-slate-900 dark:accent-slate-100"
              />
              {t("usb.hq")}
            </label>
            {usb.printing && (
              <span className="ml-auto text-[11px] tabular-nums text-slate-400">
                {t("usb.progress", { pct: Math.round(usb.progress * 100) })}
              </span>
            )}
          </div>
          {usb.lang === "tspl" && (
            <p
              data-testid="usb-label-auto-hint"
              className="mb-2 text-[11px] leading-4 text-slate-400 dark:text-slate-500"
            >
              {usb.media === "continuous" ? t("usb.mediaHint") : t("usb.labelAutoHint")}
            </p>
          )}
          {cal && usb.lang === "tspl" && (
            <p
              data-testid="usb-calibrate-status"
              className={cn(
                "mb-2 text-xs",
                cal.state === "err" && "text-red-500 dark:text-red-400",
                cal.state === "ok" && "text-emerald-600 dark:text-emerald-400",
                cal.state === "busy" && "text-slate-400"
              )}
            >
              {cal.state === "busy"
                ? t("usb.calibrating")
                : cal.state === "ok"
                  ? t("usb.calibrateOk")
                  : cal.msg}
            </p>
          )}
        </>
      )}

      <Button
        onClick={onClick}
        disabled={disabled || loading}
        className="h-11 w-full rounded-lg bg-slate-900 text-[15px] font-medium text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:shadow-none dark:hover:bg-slate-200"
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Printer className="h-5 w-5" />
        )}
        {label}
      </Button>
    </div>
  );
}

/** Плоский зелёный баннер-уведомление об успешной печати */
export function FlatBanner({ text }: { text: string }) {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
      <Printer className="h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Секции левой панели                                                 */
/* ------------------------------------------------------------------ */

export function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
        className
      )}
    >
      {children}
    </span>
  );
}

export function SectionHeader({
  icon,
  title,
  badge,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {icon}
        <span className="truncate">{title}</span>
        {badge !== undefined && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {badge}
          </span>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </div>
  );
}

export function CollapsibleSection({
  icon,
  title,
  badge,
  actions,
  open,
  onToggle,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 dark:border-slate-800",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 pr-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          {icon}
          <span className="truncate">{title}</span>
          {badge !== undefined && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {badge}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-slate-400 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
        {actions && (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        )}
      </div>
      {open && (
        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Компактные контролы строк                                           */
/* ------------------------------------------------------------------ */

export function IconBtn({
  title,
  onClick,
  disabled,
  danger,
  active,
  children,
  className,
}: {
  title: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40",
        danger
          ? "text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
          : active
            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200",
        className
      )}
    >
      {children}
    </button>
  );
}

/** Группа выравнивания: три кнопки, активная — чёрная (как на референсе) */
export function AlignGroup({
  value,
  onChange,
  className,
  t,
}: {
  value: TextAlignment;
  onChange: (v: TextAlignment) => void;
  className?: string;
  t: Translator;
}) {
  const opts = [
    { v: "left", Icon: AlignLeft, title: t("align.left") },
    { v: "center", Icon: AlignCenter, title: t("align.center") },
    { v: "right", Icon: AlignRight, title: t("align.right") },
  ] as const;
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden rounded-md border border-slate-200 dark:border-slate-700",
        className
      )}
    >
      {opts.map(({ v, Icon, title }, i) => (
        <button
          key={v}
          type="button"
          title={title}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex h-7 w-7 items-center justify-center transition-colors",
            i > 0 && "border-l border-slate-200 dark:border-slate-700",
            value === v
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

/** Компактный селект размера шрифта «28px ⌄» (нативный — как на референсе) */
export function SizeSelect({
  value,
  onChange,
  min = 10,
  max = 72,
  className,
  t,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
  t: Translator;
}) {
  const presets = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72];
  const list = Array.from(new Set([...presets, value]))
    .filter((v) => v >= min && v <= max)
    .sort((a, b) => a - b);
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={t("size.aria")}
      className={cn(
        "h-7 w-[68px] shrink-0 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
        className
      )}
    >
      {list.map((v) => (
        <option key={v} value={v}>
          {v}px
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Копии и раскладка на ленте                                          */
/* ------------------------------------------------------------------ */

/**
 * Контрол «Копии»: количество (1…50), при >1 — раскладка (столбик / в ряд)
 * и промежуток. Копии собираются в ОДИН холст печати — между ними лента не
 * протягивается. «В ряд» доступен, только если копия уже ленты (rowAvailable).
 */
export function CopiesControl({
  settings,
  onChange,
  rowAvailable = false,
  className,
  t,
}: {
  settings: CopiesSettings;
  onChange: (patch: Partial<CopiesSettings>) => void;
  /** «В ряд» физически возможен (копия уже 384 px) */
  rowAvailable?: boolean;
  className?: string;
  t: Translator;
}) {
  const multi = settings.copies > 1;
  const setLayout = (layout: CopiesLayout) => onChange({ layout });
  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Copy className="h-4 w-4 shrink-0 text-slate-400" />
          {t("copies.title")}
        </div>
        <div className="flex items-center gap-1">
          <IconBtn
            title={t("copies.less")}
            disabled={settings.copies <= 1}
            onClick={() => onChange({ copies: clampCopies(settings.copies - 1) })}
          >
            <Minus className="h-4 w-4" />
          </IconBtn>
          <span
            aria-label={t("copies.countAria")}
            className="w-7 text-center text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100"
          >
            {settings.copies}
          </span>
          <IconBtn
            title={t("copies.more")}
            disabled={settings.copies >= COPIES_MAX}
            onClick={() => onChange({ copies: clampCopies(settings.copies + 1) })}
          >
            <Plus className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      {multi && (
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              aria-pressed={settings.layout === "stack"}
              title={t("copies.stackTitle")}
              onClick={() => setLayout("stack")}
              className={cn(
                "h-7 flex-1 text-xs font-medium transition-colors",
                settings.layout === "stack"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
            >
              {t("copies.stack")}
            </button>
            <button
              type="button"
              aria-pressed={settings.layout === "row"}
              disabled={!rowAvailable}
              title={
                rowAvailable
                  ? t("copies.rowTitle")
                  : t("copies.rowUnavailable")
              }
              onClick={() => setLayout("row")}
              className={cn(
                "h-7 flex-1 border-l border-slate-200 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 dark:border-slate-700",
                settings.layout === "row"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
            >
              {t("copies.row")}
            </button>
          </div>
          <select
            value={settings.gap}
            aria-label={t("copies.gapAria")}
            onChange={(e) => onChange({ gap: Number(e.target.value) })}
            className="h-7 w-[104px] shrink-0 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 shadow-xs outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {COPIES_GAP_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {t("copies.gap", { n: g })}
              </option>
            ))}
          </select>
        </div>
      )}
      {multi && (
        <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
          {t("copies.hint")}
        </p>
      )}
    </div>
  );
}

/**
 * Контрол «Этикетка (длина ленты)»: режим «Авто» (высота под содержимое)
 * или фиксированная высота — типовые этикетки 30/40/50/90 мм и своё значение.
 * Один глобальный стор (mxw01-label-size): контрол живёт в настройках шапки
 * и в каждой вкладке печати («Лента», «Ценник») — значение везде общее,
 * изменение в любом месте мгновенно видно в остальных.
 */
export function LabelSizeControl({
  className,
  t,
}: {
  className?: string;
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
}) {
  const [labelSize, setLabelSize] = useLabelSize();
  // Уникальный id поля «Своё»: контрол может быть в DOM в нескольких
  // экземплярах одновременно (вкладка + открытый диалог настроек шапки)
  const inputId = React.useId();

  /** Применить своё значение высоты из поля ввода (мм) */
  const commitCustomMm = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(v)) return; // пусто/неверно — не трогаем
    setLabelSize({ mode: "fixed", heightMm: clampLabelMm(v) });
  };

  const presetBtn = (active: boolean) =>
    cn(
      "h-8 rounded-lg border text-sm font-medium transition-colors",
      active
        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
    );

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800",
        className
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <Ruler className="h-4 w-4 shrink-0 text-slate-400" />
        {t("set.label")}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        <button
          type="button"
          aria-pressed={labelSize.mode === "auto"}
          onClick={() => setLabelSize({ ...labelSize, mode: "auto" })}
          className={presetBtn(labelSize.mode === "auto")}
        >
          {t("set.labelAuto")}
        </button>
        {LABEL_MM_PRESETS.map((mm) => (
          <button
            key={mm}
            type="button"
            aria-pressed={labelSize.mode === "fixed" && labelSize.heightMm === mm}
            onClick={() => setLabelSize({ mode: "fixed", heightMm: mm })}
            className={presetBtn(
              labelSize.mode === "fixed" && labelSize.heightMm === mm
            )}
          >
            {mm}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Label
          htmlFor={inputId}
          className="shrink-0 text-xs text-slate-500 dark:text-slate-400"
        >
          {t("set.labelCustom")}
        </Label>
        <Input
          id={inputId}
          key={`${labelSize.mode}-${labelSize.heightMm}`}
          type="number"
          inputMode="numeric"
          min={LABEL_MM_MIN}
          max={LABEL_MM_MAX}
          defaultValue={labelSize.mode === "fixed" ? String(labelSize.heightMm) : ""}
          placeholder={t("set.labelCustomPlaceholder")}
          aria-label={t("set.labelCustomAria")}
          className="h-8 w-20 text-sm tabular-nums"
          onBlur={(e) => commitCustomMm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitCustomMm((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {t("set.labelMmUnit")}
        </span>
        {labelSize.mode === "fixed" && (
          <span className="ml-auto text-xs tabular-nums text-slate-400 dark:text-slate-500">
            {t("set.labelPx", { n: mmToLabelPx(labelSize.heightMm) })}
          </span>
        )}
      </div>
    </div>
  );
}
