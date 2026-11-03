"use client";
/**
 * Инструмент «QR-код»: генерация QR по произвольным данным пользователя
 * (ссылка, текст, телефон, всё что угодно) с опциональной подписью.
 * Уровень коррекции ошибок — по стандарту L/M/Q/H.
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import type { Translator } from "@/lib/printer/i18n";
import type { QrToolData } from "@/lib/printer/types";
import { ToolField, ToolInput, ToolSelect, ToolTextarea } from "./tools-shared";

export function QrFields({
  value,
  onChange,
  t,
}: {
  value: QrToolData;
  onChange: (patch: Partial<QrToolData>) => void;
  t: Translator;
}) {
  return (
    <div className="space-y-3">
      <ToolField label={t("tool.qr.data")}>
        <ToolTextarea
          value={value.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder={t("tool.qr.dataPh")}
          aria-label={t("tool.qr.data")}
        />
      </ToolField>
      <ToolField label={t("tool.qr.level")}>
        <ToolSelect
          value={value.level}
          onChange={(v) => onChange({ level: v as QrToolData["level"] })}
          ariaLabel={t("tool.qr.level")}
          options={[
            { value: "L", label: "L · 7%" },
            { value: "M", label: "M · 15%" },
            { value: "Q", label: "Q · 25%" },
            { value: "H", label: "H · 30%" },
          ]}
        />
      </ToolField>
      <ToolField label={t("tool.qr.caption")}>
        <ToolInput
          value={value.caption}
          onChange={(e) => onChange({ caption: e.target.value })}
          placeholder={t("tool.qr.captionPh")}
          aria-label={t("tool.qr.caption")}
        />
      </ToolField>
      <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">{t("tool.qr.hint")}</p>
    </div>
  );
}
