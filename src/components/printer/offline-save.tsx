"use client";
/**
 * Сохранение офлайн-версии из интерфейса сайта.
 *
 * • Ctrl/Cmd+S на САЙТЕ открывает диалог: предлагаем скачать автономный
 *   mxw01-offline.html (портативная версия, без аналитики) вместо
 *   стандартного «Сохранить страницу как». Одна кнопка скачивания — HTML.
 *   Слушатель — в capture-фазе на window (наивысший приоритет: срабатывает
 *   раньше любых других обработчиков), а код клавиши проверяется по e.code
 *   (KeyS) — он НЕ зависит от раскладки: на русской Ctrl+S браузер отдаёт
 *   key="ы", и проверка по key пропускала событие (нативный диалог Chrome).
 *   В офлайн-версии (file://) перехвата нет — там Ctrl+S остаётся штатным
 *   «Сохранить как», которым пересохраняют рабочую копию (см. README).
 * • В настройках (шестерёнка) под выбором языка кнопка «Сохранить
 *   офлайн-версию» — она шлёт событие "mxw01:offline-save", менеджер
 *   открывает тот же диалог (паттерн как у "mxw01:ble-warning").
 *
 * Файлы отдаются из корня сайта (build-static-webpack.sh кладёт их в
 * деплой-пакет из download/): относительные ссылки работают и в подпапке.
 *
 * Только UI-слой: драйвер печати и отправка на печать не затронуты.
 */
import React, { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Translator } from "@/lib/printer/i18n";
import { Download, HardDriveDownload } from "lucide-react";

/** Событие для открытия диалога из настроек (и других мест) */
export const OFFLINE_SAVE_EVENT = "mxw01:offline-save";

function isFileProtocol(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "file:";
}

export function OfflineSaveDialog({
  t,
  open,
  onOpenChange,
}: {
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Диалог рендерится только после открытия (клиентское событие),
  // поэтому чтение location здесь безопасно для гидратации.
  // [open] — пересчитать при каждом открытии (кнопка настроек в том же окне).
  const fileMode = useMemo(() => isFileProtocol(), [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-3 rounded-xl sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <HardDriveDownload className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {t("off.title")}
          </DialogTitle>
          <DialogDescription className="text-left text-sm leading-relaxed">
            {t("off.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {fileMode ? (
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t("off.already")}
            </p>
          ) : (
            <a
              href="mxw01-offline.html"
              download
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              <Download className="h-4 w-4" />
              {t("off.htmlBtn")}
            </a>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-lg"
          >
            {t("off.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Монтируется один раз: перехватывает Ctrl/Cmd+S на сайте и слушает
 * событие OFFLINE_SAVE_EVENT (кнопка в настройках).
 */
export function OfflineSaveManager({ t }: { t: Translator }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // e.code не зависит от раскладки: на русской Ctrl+S даёт key="ы",
      // поэтому первичная проверка — по физическому коду клавиши (KeyS);
      // проверка по key оставлена как фолбэк (виртуальные клавиатуры).
      const isS = e.code === "KeyS" || (e.key ?? "").toLowerCase() === "s";
      if (!isS) return;
      // file://: Ctrl+S остаётся штатным сохранением рабочей копии
      if (isFileProtocol()) return;
      // Наивысший приоритет: блокируем нативное «Сохранить страницу» и не
      // пускаем событие дальше (capture-фаза — мы уже первые слушатели).
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    const onOpenRequest = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener(OFFLINE_SAVE_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener(OFFLINE_SAVE_EVENT, onOpenRequest);
    };
  }, []);

  return <OfflineSaveDialog t={t} open={open} onOpenChange={setOpen} />;
}
