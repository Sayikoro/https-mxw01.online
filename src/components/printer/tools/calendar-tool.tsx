"use client";
/**
 * Инструмент «Календарь»: сетка выбранного месяца под ширину ленты 384 px,
 * с выбором начала недели и выделением выходных.
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import type { Lang, Translator } from "@/lib/printer/i18n";
import type { CalendarToolData } from "@/lib/printer/types";
import { ToolToggle } from "./tools-shared";
import { MonthYearFields, WeekStartSelect } from "./month-fields";

export function CalendarFields({
  value,
  onChange,
  t,
  lang,
}: {
  value: CalendarToolData;
  onChange: (patch: Partial<CalendarToolData>) => void;
  t: Translator;
  lang: Lang;
}) {
  return (
    <div className="space-y-3">
      <MonthYearFields
        lang={lang}
        year={value.year}
        month={value.month}
        onChange={(patch) => onChange(patch)}
        monthLabel={t("tool.calendar.month")}
        yearLabel={t("tool.calendar.year")}
      />
      <WeekStartSelect t={t} value={value.weekStart} onChange={(v) => onChange({ weekStart: v })} />
      <ToolToggle label={t("tool.calendar.weekends")} checked={value.weekends} onChange={(v) => onChange({ weekends: v })} />
    </div>
  );
}
