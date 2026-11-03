"use client";
/**
 * ============================================================================
 *  «ИЗМЕНЕНИЯ ПО ВЕРСИЯМ» — окно с содержимым versions.md (v1.0.28).
 * ============================================================================
 *  Файл /versions.md отдаёт сам сайт (роут src/app/versions.md/route.ts
 *  читает versions.md из корня проекта при сборке) — история всегда
 *  совпадает с установленной версией. Файл запрашивается заново при каждом
 *  открытии окна (cache: no-store) — правки истории видны без перезагрузки.
 *  Если файл недоступен (нет сети либо сохранённая офлайн-копия) — окно
 *  показывает ошибку с подсказкой и кнопкой «Повторить».
 *
 *  Мини-рендер Markdown без внешних библиотек: заголовки версий, списки,
 *  **жирный** текст и `код`; длинный список прокручивается внутри окна.
 * ============================================================================
 */
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw } from "lucide-react";
import type { Translator } from "@/lib/printer/i18n";

/** Строка markdown → React-узел: **жирный** и `код` */
function inlineMd(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(
        <code key={key++} className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">
          {token.slice(1, -1)}
        </code>
      );
    }
    last = m.index + token.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Мини-рендер Markdown: заголовки ##/###, списки, разделители --- */
function MarkdownView({ md }: { md: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let key = 0;
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={key++} className="list-disc space-y-1 pl-5">
        {list.map((li, i) => (
          <li key={i}>{inlineMd(li)}</li>
        ))}
      </ul>
    );
    list = [];
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^#{2,3}\s/.test(line)) {
      flushList();
      const text = line.replace(/^#{2,3}\s/, "");
      const isH2 = /^##\s/.test(line);
      blocks.push(
        <div
          key={key++}
          className={
            isH2
              ? "pt-2 text-sm font-bold text-slate-900 dark:text-slate-100"
              : "pt-1 text-[13px] font-semibold text-slate-700 dark:text-slate-200"
          }
        >
          {inlineMd(text)}
        </div>
      );
    } else if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      list.push(line.replace(/^[-*]\s/, "").replace(/^\d+\.\s/, ""));
    } else if (/^---+$/.test(line)) {
      flushList();
      blocks.push(<div key={key++} className="my-1 border-t border-slate-200 dark:border-slate-800" />);
    } else if (line.trim() === "") {
      flushList();
    } else if (line.startsWith("**") && line.endsWith("**")) {
      flushList();
      blocks.push(
        <p key={key++} className="pt-1 text-[13px] font-bold">
          {line.slice(2, -2)}
        </p>
      );
    } else {
      flushList();
      blocks.push(
        <p key={key++} className="text-[13px] leading-relaxed">
          {inlineMd(line)}
        </p>
      );
    }
  }
  flushList();
  return <div className="space-y-1.5">{blocks}</div>;
}

export function ChangelogDialog({
  t,
  open,
  onOpenChange,
}: {
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [md, setMd] = useState("");
  const [tick, setTick] = useState(0);

  // Файл запрашивается заново при каждом открытии — правки видны сразу.
  // Загрузка стартует асинхронно (setTimeout 0), чтобы не звать setState
  // синхронно в теле эффекта.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setState("loading");
      fetch("/versions.md", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then((text) => {
          if (cancelled) return;
          setMd(text);
          setState("ok");
        })
        .catch(() => {
          if (cancelled) return;
          setState("error");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, tick]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("chg.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-400 dark:text-slate-500">{t("chg.desc")}</p>
        <div className="max-h-[55dvh] overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          {state === "loading" && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("chg.loading")}
            </div>
          )}
          {state === "error" && (
            <div className="space-y-2 py-6 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("chg.error")}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">{t("chg.errorHint")}</p>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setTick((v) => v + 1)}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t("chg.retry")}
              </Button>
            </div>
          )}
          {state === "ok" && <MarkdownView md={md} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
