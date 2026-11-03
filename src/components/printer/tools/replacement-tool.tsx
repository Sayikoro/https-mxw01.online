"use client";
/**
 * Инструмент «Замена»: этикетка обслуживания «Заменено: дата · следующая
 * через N дн./мес./г.» — наклейка на устройство (фильтры, картриджи, вода
 * и т.п.). Дата следующей замены считается автоматически (конец месяца
 * зажимается, как у сроков годности), есть рамка и типографика блока.
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import type { Lang, Translator } from "@/lib/printer/i18n";
import type { ReplacementToolData } from "@/lib/printer/types";
import { addDuration, formatDateHuman } from "@/lib/printer/tools-data";
import type { DurationUnit } from "@/lib/printer/tools-data";
import { ToolField, ToolInput, ToolSelect, ToolToggle } from "./tools-shared";

export function ReplacementFields({
  value,
  onChange,
  t,
  lang,
}: {
  value: ReplacementToolData;
  onChange: (patch: Partial<ReplacementToolData>) => void;
  t: Translator;
  lang: Lang;
}) {
  const next = addDuration(value.date, value.amount, value.unit);

  return (
    <div className="space-y-3">
      <ToolField label={t("tool.replace.name")}>
        <ToolInput
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t("tool.replace.namePh")}
          aria-label={t("tool.replace.name")}
        />
      </ToolField>
      <div className="grid grid-cols-2 gap-2">
        <ToolField label={t("tool.replace.date")}>
          <ToolInput
            type="date"
            value={value.date}
            onChange={(e) => onChange({ date: e.target.value || value.date })}
            aria-label={t("tool.replace.date")}
          />
        </ToolField>
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <ToolField label={t("tool.replace.after")}>
            <ToolInput
              type="number"
              inputMode="numeric"
              min={1}
              value={value.amount || ""}
              onChange={(e) => onChange({ amount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              aria-label={t("tool.replace.after")}
              className="text-right tabular-nums"
            />
          </ToolField>
          <div className="flex items-end pb-[2px]">
            <ToolSelect
              value={value.unit}
              onChange={(v) => onChange({ unit: v as DurationUnit })}
              ariaLabel={t("tool.replace.unitAria")}
              options={[
                { value: "day", label: t("tool.replace.unitDay") },
                { value: "month", label: t("tool.replace.unitMonth") },
                { value: "year", label: t("tool.replace.unitYear") },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <ToolToggle label={t("tool.replace.showNext")} checked={value.showNext} onChange={(v) => onChange({ showNext: v })} />
        <ToolToggle label={t("tool.replace.border")} checked={value.border} onChange={(v) => onChange({ border: v })} />
      </div>
      {value.showNext && (
        <p className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {t("tool.replace.next")}: {formatDateHuman(next, lang)}
        </p>
      )}
    </div>
  );
}
