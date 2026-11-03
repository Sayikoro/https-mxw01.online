"use client";
/**
 * Инструмент «Нумерация»: серия номеров с префиксом/суффиксом и дополнением
 * нулями, опционально со штрихкодом Code-128 под каждым номером.
 * Метки печатаются подряд; длинные серии нарезаются на страницы ≤ 90 мм
 * с разрывом между метками.
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import type { Translator } from "@/lib/printer/i18n";
import type { NumbersToolData } from "@/lib/printer/types";
import { isBarcodeSafe, numberSeries, SERIES_MAX } from "@/lib/printer/tools-data";
import { ToolField, ToolInput, ToolToggle } from "./tools-shared";

export function NumbersFields({
  value,
  onChange,
  t,
}: {
  value: NumbersToolData;
  onChange: (patch: Partial<NumbersToolData>) => void;
  t: Translator;
}) {

  const lastLabel = numberSeries({
    prefix: value.prefix,
    postfix: value.postfix,
    start: Math.max(0, value.start) + Math.min(SERIES_MAX, value.count) - 1,
    count: 1,
    pad: value.pad,
  })[0];
  const barcodeBroken = value.barcode && !isBarcodeSafe(lastLabel);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <ToolField label={t("tool.numbers.prefix")}>
          <ToolInput
            value={value.prefix}
            onChange={(e) => onChange({ prefix: e.target.value })}
            placeholder="SK-"
            aria-label={t("tool.numbers.prefix")}
            autoComplete="off"
          />
        </ToolField>
        <ToolField label={t("tool.numbers.postfix")}>
          <ToolInput
            value={value.postfix}
            onChange={(e) => onChange({ postfix: e.target.value })}
            placeholder="/A"
            aria-label={t("tool.numbers.postfix")}
            autoComplete="off"
          />
        </ToolField>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ToolField label={t("tool.numbers.start")}>
          <ToolInput
            type="number"
            inputMode="numeric"
            min={0}
            value={value.start}
            onChange={(e) => onChange({ start: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            aria-label={t("tool.numbers.start")}
            className="text-right tabular-nums"
          />
        </ToolField>
        <ToolField label={t("tool.numbers.count")}>
          <ToolInput
            type="number"
            inputMode="numeric"
            min={1}
            max={SERIES_MAX}
            value={value.count}
            onChange={(e) =>
              onChange({ count: Math.min(SERIES_MAX, Math.max(1, Math.floor(Number(e.target.value) || 1))) })
            }
            aria-label={t("tool.numbers.count")}
            className="text-right tabular-nums"
          />
        </ToolField>
        <ToolField label={t("tool.numbers.pad")}>
          <ToolInput
            type="number"
            inputMode="numeric"
            min={0}
            max={12}
            value={value.pad}
            onChange={(e) => onChange({ pad: Math.min(12, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
            aria-label={t("tool.numbers.pad")}
            className="text-right tabular-nums"
          />
        </ToolField>
      </div>
      <ToolToggle
        label={t("tool.numbers.barcode")}
        checked={value.barcode}
        onChange={(v) => onChange({ barcode: v })}
      />
      {barcodeBroken && (
        <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">{t("tool.numbers.barcodeHint")}</p>
      )}
    </div>
  );
}
