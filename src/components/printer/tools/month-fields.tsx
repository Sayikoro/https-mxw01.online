"use client";
/**
 * Инструменты «Календарь» и «Трекер привычек» — общие контролы месяца:
 * селектор месяца (имена месяцев по локали), год и начало недели.
 */
import React from "react";
import type { Lang, Translator } from "@/lib/printer/i18n";
import { ToolField, ToolInput, ToolSelect } from "./tools-shared";

export const MONTH_MIN = 1970;
export const MONTH_MAX = 2100;

export function clampYear(y: number): number {
  return Math.min(MONTH_MAX, Math.max(MONTH_MIN, Math.floor(y) || MONTH_MIN));
}

/** Селектор месяца + поле года */
export function MonthYearFields({
  year,
  month,
  onChange,
  monthLabel,
  yearLabel,
  lang,
}: {
  year: number;
  month: number;
  onChange: (patch: { year?: number; month?: number }) => void;
  monthLabel: string;
  yearLabel: string;
  /** Локаль имён месяцев — через пропсы (словари в src/locales) */
  lang: Lang;
}) {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(2026, i, 1).toLocaleDateString(locale, { month: "long" }),
  }));
  return (
    <div className="grid grid-cols-[1fr_100px] gap-2">
      <ToolField label={monthLabel}>
        <ToolSelect
          value={String(month)}
          onChange={(v) => onChange({ month: Number(v) })}
          ariaLabel={monthLabel}
          options={monthOptions}
        />
      </ToolField>
      <ToolField label={yearLabel}>
        <ToolInput
          type="number"
          inputMode="numeric"
          min={MONTH_MIN}
          max={MONTH_MAX}
          value={year}
          onChange={(e) => onChange({ year: clampYear(Number(e.target.value)) })}
          aria-label={yearLabel}
          className="text-right tabular-nums"
        />
      </ToolField>
    </div>
  );
}

/** Селектор «с какого дня начинается неделя» */
export function WeekStartSelect({
  value,
  onChange,
  t,
}: {
  value: 0 | 1;
  onChange: (v: 0 | 1) => void;
  t: Translator;
}) {
  return (
    <ToolField label={t("tool.calcommon.weekStart")}>
      <ToolSelect
        value={String(value)}
        onChange={(v) => onChange(v === "0" ? 0 : 1)}
        ariaLabel={t("tool.calcommon.weekStart")}
        options={[
          { value: "1", label: t("tool.calcommon.mon") },
          { value: "0", label: t("tool.calcommon.sun") },
        ]}
      />
    </ToolField>
  );
}
