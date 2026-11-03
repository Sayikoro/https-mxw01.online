"use client";
/**
 * Инструмент «Чек»: магазин, позиции (название × цена × количество),
 * скидка, итог считается автоматически. Классическая моноширинная вёрстка
 * чека с пунктирами; длинный чек печатается страницами ≤ 90 мм.
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Translator } from "@/lib/printer/i18n";
import type { ReceiptToolData } from "@/lib/printer/types";
import { formatMoney, receiptTotals } from "@/lib/printer/tools-data";
import { IconBtn } from "../shell";
import { ToolField, ToolInput, ToolToggle, toolUid } from "./tools-shared";

export function ReceiptFields({
  value,
  onChange,
  t,
}: {
  value: ReceiptToolData;
  onChange: (patch: Partial<ReceiptToolData>) => void;
  t: Translator;
}) {

  const addItem = () => onChange({ items: [...value.items, { id: toolUid(), name: "", price: 0, qty: 1 }] });
  const patchItem = (id: string, patch: Partial<{ name: string; price: number; qty: number }>) =>
    onChange({ items: value.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  const removeItem = (id: string) => onChange({ items: value.items.filter((it) => it.id !== id) });

  const named = value.items.filter((it) => it.name.trim() || it.price > 0);
  const totals = receiptTotals(
    named.map((it) => ({ name: it.name, price: it.price, qty: it.qty })),
    value.discount
  );

  return (
    <div className="space-y-3">
      <ToolField label={t("tool.receipt.shop")}>
        <ToolInput
          value={value.shop}
          onChange={(e) => onChange({ shop: e.target.value })}
          placeholder={t("tool.receipt.shopPh")}
          aria-label={t("tool.receipt.shop")}
        />
      </ToolField>
      <ToolToggle label={t("tool.receipt.showDate")} checked={value.showDate} onChange={(v) => onChange({ showDate: v })} />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">{t("tool.receipt.items")}</span>
          {named.length > 0 && (
            <span className="text-xs tabular-nums text-slate-400">
              {t("tool.receipt.subtotal")}: {formatMoney(totals.subtotal)}
            </span>
          )}
        </div>
        {value.items.map((it) => (
          <div key={it.id} className="flex items-center gap-1.5">
            <ToolInput
              value={it.name}
              onChange={(e) => patchItem(it.id, { name: e.target.value })}
              placeholder={t("tool.receipt.namePh")}
              aria-label={t("tool.receipt.namePh")}
              className="min-w-0 flex-1"
            />
            <ToolInput
              type="number"
              inputMode="decimal"
              min={0}
              value={it.price || ""}
              onChange={(e) => patchItem(it.id, { price: Number(e.target.value) || 0 })}
              placeholder={t("tool.receipt.pricePh")}
              aria-label={t("tool.receipt.pricePh")}
              className="w-20 shrink-0 text-right tabular-nums"
            />
            <ToolInput
              type="number"
              inputMode="numeric"
              min={1}
              value={it.qty || ""}
              onChange={(e) => patchItem(it.id, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              aria-label={t("tool.receipt.qty")}
              className="w-14 shrink-0 text-right tabular-nums"
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
          {t("tool.receipt.addItem")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ToolField label={t("tool.receipt.discount")}>
          <ToolInput
            type="number"
            inputMode="numeric"
            min={0}
            max={90}
            value={value.discount || ""}
            onChange={(e) => onChange({ discount: Math.min(90, Math.max(0, Number(e.target.value) || 0)) })}
            aria-label={t("tool.receipt.discount")}
            className="text-right tabular-nums"
          />
        </ToolField>
        <div className="flex items-end justify-end pb-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {t("tool.receipt.total")}: {formatMoney(totals.total)}
        </div>
      </div>

      <ToolField label={t("tool.receipt.footer")}>
        <ToolInput
          value={value.footer}
          onChange={(e) => onChange({ footer: e.target.value })}
          placeholder={t("tool.receipt.footerPh")}
          aria-label={t("tool.receipt.footer")}
        />
      </ToolField>
    </div>
  );
}
