"use client";
/**
 * Инструмент «Трекер привычек»: до 6 привычек (колонки) × дни месяца
 * (строки с пустыми клеточками). Печатается и отмечается вручную.
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Lang, Translator } from "@/lib/printer/i18n";
import type { HabitsToolData } from "@/lib/printer/types";
import { IconBtn } from "../shell";
import { ToolInput } from "./tools-shared";
import { MonthYearFields } from "./month-fields";

export function HabitsFields({
  value,
  onChange,
  t,
  lang,
}: {
  value: HabitsToolData;
  onChange: (patch: Partial<HabitsToolData>) => void;
  t: Translator;
  lang: Lang;
}) {

  const patchHabit = (i: number, text: string) =>
    onChange({ habits: value.habits.map((h, hi) => (hi === i ? text : h)) });
  const removeHabit = (i: number) => onChange({ habits: value.habits.filter((_h, hi) => hi !== i) });
  const addHabit = () => onChange({ habits: [...value.habits, ""] });

  return (
    <div className="space-y-3">
      <MonthYearFields
        lang={lang}
        year={value.year}
        month={value.month}
        onChange={(patch) => onChange(patch)}
        monthLabel={t("tool.habits.month")}
        yearLabel={t("tool.habits.year")}
      />
      <div className="space-y-1.5">
        {value.habits.map((h, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-center text-xs tabular-nums text-slate-400">{i + 1}</span>
            <ToolInput
              value={h}
              onChange={(e) => patchHabit(i, e.target.value)}
              placeholder={t("tool.habits.itemPh")}
              aria-label={t("tool.habits.itemAria")}
            />
            <IconBtn title={t("tool.checklist.remove")} danger onClick={() => removeHabit(i)}>
              <Trash2 className="h-4 w-4" />
            </IconBtn>
          </div>
        ))}
        {value.habits.length < 6 && (
          <button
            type="button"
            onClick={addHabit}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-200 dark:hover:text-slate-100"
          >
            <Plus className="h-4 w-4" />
            {t("tool.habits.add")}
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">{t("tool.habits.hint")}</p>
    </div>
  );
}
