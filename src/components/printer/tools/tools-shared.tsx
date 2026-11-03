"use client";
/**
 * Общие контролы форм генераторов ленты (бывшая вкладка «Инструменты»):
 * поля ввода в единой гамме карточек ленты. Сами данные хранятся в
 * ToolItem ленты, рендер — в tools-render.ts, печать — общим пайплайном
 * ленты (tape-builder.tsx). Драйвер печати не затрагивается.
 */
import React from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Простой уникальный id для пунктов списков */
export function toolUid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ */
/* Контролы форм                                                       */
/* ------------------------------------------------------------------ */

export function ToolField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500 dark:text-slate-400">{label}</Label>
      {children}
    </div>
  );
}

export function ToolInput(props: React.ComponentProps<typeof Input>) {
  return <Input {...props} className={cn("h-9 text-sm", props.className)} />;
}

export function ToolTextarea(props: React.ComponentProps<typeof Textarea>) {
  return <Textarea {...props} className={cn("min-h-[72px] text-sm", props.className)} />;
}

export function ToolSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-xs outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Переключатель-пилюля (вкл/выкл) в стиле пресетов «Этикетки» */
export function ToolToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
        checked
          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-md border",
          checked ? "border-white/60 dark:border-slate-900/40" : "border-slate-300 dark:border-slate-600"
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}
