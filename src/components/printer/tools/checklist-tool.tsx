"use client";
/**
 * Инструмент «Чек-лист»: заголовок + пункты с чекбоксами. Клик по квадрату
 * отмечает пункт — на печати он выходит с галочкой. Длинные списки печатаются
 * страницами ≤ 90 мм с разрывом между пунктами.
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import type { Translator } from "@/lib/printer/i18n";
import type { ChecklistToolData } from "@/lib/printer/types";
import { IconBtn } from "../shell";
import { ToolField, ToolInput, toolUid } from "./tools-shared";

export function ChecklistFields({
  value,
  onChange,
  t,
}: {
  value: ChecklistToolData;
  onChange: (patch: Partial<ChecklistToolData>) => void;
  t: Translator;
}) {

  const addItem = () => onChange({ items: [...value.items, { id: toolUid(), text: "", done: false }] });
  const patchItem = (id: string, patch: Partial<{ text: string; done: boolean }>) =>
    onChange({ items: value.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  const removeItem = (id: string) => onChange({ items: value.items.filter((it) => it.id !== id) });

  return (
    <div className="space-y-3">
      <ToolField label={t("tool.checklist.titleField")}>
        <ToolInput
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t("tool.checklist.titlePh")}
          aria-label={t("tool.checklist.titleField")}
        />
      </ToolField>

      <div className="space-y-1.5">
        {value.items.map((it) => (
          <div key={it.id} className="flex items-center gap-1.5">
            <button
              type="button"
              role="checkbox"
              aria-checked={it.done}
              aria-label={t("tool.checklist.markAria")}
              onClick={() => patchItem(it.id, { done: !it.done })}
              className={
                it.done
                  ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 text-transparent hover:border-slate-400 dark:border-slate-600"
              }
            >
              <Check className="h-4 w-4" />
            </button>
            <ToolInput
              value={it.text}
              onChange={(e) => patchItem(it.id, { text: e.target.value })}
              placeholder={t("tool.checklist.itemPh")}
              aria-label={t("tool.checklist.itemAria")}
            />
            <IconBtn title={t("tool.checklist.remove")} danger onClick={() => removeItem(it.id)}>
              <Trash2 className="h-4 w-4" />
            </IconBtn>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-200 dark:hover:text-slate-100"
        >
          <Plus className="h-4 w-4" />
          {t("tool.checklist.add")}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">{t("tool.checklist.hint")}</p>
    </div>
  );
}
