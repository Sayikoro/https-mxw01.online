"use client";
/**
 * Инструмент «Сроки годности»: этикетка с названием и датами
 * «изготовлено» / «годно до». Дата «годно до» считается из даты
 * изготовления плюс срок (дни/месяцы/годы, конец месяца зажимается).
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import type { Lang, Translator } from "@/lib/printer/i18n";
import type { DatesToolData } from "@/lib/printer/types";
import { addDuration, formatDateHuman } from "@/lib/printer/tools-data";
import type { DurationUnit } from "@/lib/printer/tools-data";
import { ToolField, ToolInput, ToolSelect, ToolToggle } from "./tools-shared";

export function DatesFields({
  value,
  onChange,
  t,
  lang,
}: {
  value: DatesToolData;
  onChange: (patch: Partial<DatesToolData>) => void;
  t: Translator;
  lang: Lang;
}) {
  const until = addDuration(value.made, value.amount, value.unit);

  return (
    <div className="space-y-3">
      <ToolField label={t("tool.dates.name")}>
        <ToolInput
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t("tool.dates.namePh")}
          aria-label={t("tool.dates.name")}
        />
      </ToolField>
      <div className="grid grid-cols-2 gap-2">
        <ToolField label={t("tool.dates.made")}>
          <ToolInput
            type="date"
            value={value.made}
            onChange={(e) => onChange({ made: e.target.value || value.made })}
            aria-label={t("tool.dates.made")}
          />
        </ToolField>
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <ToolField label={t("tool.dates.shelf")}>
            <ToolInput
              type="number"
              inputMode="numeric"
              min={1}
              value={value.amount || ""}
              onChange={(e) => onChange({ amount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              aria-label={t("tool.dates.shelf")}
              className="text-right tabular-nums"
            />
          </ToolField>
          <div className="flex items-end pb-[2px]">
            <ToolSelect
              value={value.unit}
              onChange={(v) => onChange({ unit: v as DurationUnit })}
              ariaLabel={t("tool.dates.unitAria")}
              options={[
                { value: "day", label: t("tool.dates.unitDay") },
                { value: "month", label: t("tool.dates.unitMonth") },
                { value: "year", label: t("tool.dates.unitYear") },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <ToolToggle label={t("tool.dates.showMade")} checked={value.showMade} onChange={(v) => onChange({ showMade: v })} />
        <ToolToggle label={t("tool.dates.showUntil")} checked={value.showUntil} onChange={(v) => onChange({ showUntil: v })} />
        <ToolToggle label={t("tool.dates.border")} checked={value.border} onChange={(v) => onChange({ border: v })} />
      </div>
      {value.showUntil && (
        <p className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {t("tool.dates.until")}: {formatDateHuman(until, lang)}
        </p>
      )}
    </div>
  );
}
