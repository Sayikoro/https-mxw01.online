"use client";
/**
 * Предупреждение для браузеров без Web Bluetooth (Safari, Firefox и все
 * обычные браузеры iPhone/iPad): подключиться к принтеру не получится.
 *
 * В тексте показывается имя браузера пользователя (парсинг UA — по самому
 * грубому признаку, точность не критична).
 *
 * Открывается:
 *  • автоматически при загрузке страницы, если браузер не поддерживается;
 *  • по клику на кнопку «Нет Bluetooth» в шапке;
 *  • по событию "mxw01:ble-warning" из вкладок (попытка печати).
 *
 * Закрывается САМ, когда Web Bluetooth появляется: beacio (Safari Web
 * Extension) инжектирует navigator.bluetooth после того, как пользователь
 * включит расширение и разрешит доступ к сайтам — контекст принтера
 * замечает это живым опросом, статус уходит из «unsupported» и плашка
 * закрывается (с тостом-подтверждением в шапке).
 *
 * Рекомендация: на iOS/iPadOS — beacio (Safari Web Extension, добавляет
 * Web Bluetooth прямо в Safari — обычные браузеры там работают на WebKit,
 * даже «Chrome»), альтернатива — отдельный браузер Bluefy. Установка
 * приложения — только полдела: расширение надо включить в Safari и
 * разрешить доступ к сайтам (шаги показываются в плашке), а после —
 * нажать «Проверить снова». На десктопном Firefox Web Bluetooth добавляет
 * расширение WebBT + его нативное приложение WebBT Server (текст —
 * ble.descFirefox): инжект navigator.bluetooth ловится тем же живым
 * опросом, и плашка закрывается сама. Firefox на Android остаётся без
 * поддержки — там нужен Chromium-браузер (Chrome / Edge / Opera); на
 * iPhone Firefox — тот же WebKit, работает общий iOS-совет.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Translator } from "@/lib/printer/i18n";
import { usePrinter } from "@/lib/printer/printer-context";
import { BluetoothOff, ExternalLink, Globe, RefreshCw } from "lucide-react";

const CHROME_URL = "https://www.google.com/chrome/";
const BLUEFY_URL =
  "https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055";
/* beacio — Safari Web Extension + приложение: прокидывает Web Bluetooth
 * прямо в Safari, поэтому на iOS он — основная рекомендация (пользователь
 * остаётся в своём браузере). Проверено: apps.apple.com/lookup id6761301368.
 * Требование beacio: iOS 26.2+. Расширение ставит маркер navigator.beacio
 * рядом с navigator.bluetooth — по нему распознаём активный beacio и даём
 * точную подсказку (скорее всего, не выданы разрешения на сайты). */
const BEACIO_URL = "https://apps.apple.com/app/beacio/id6761301368";

/** iOS/iPadOS: обычные браузеры там на WebKit — Web Bluetooth недоступен */
function isIosLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ по умолчанию притворяется «Macintosh» — отличаем по мультитачу
  const iPadAsMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return iOS || iPadAsMac;
}

/** Firefox: десктоп/Android (Firefox/) и iOS (FxiOS/ — движок WebKit) */
function isFirefox(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Firefox\/|FxiOS\//.test(navigator.userAgent ?? "");
}

/** Имя браузера для подсказки (грубый парсинг UA — точность не критична) */
function browserName(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent ?? "";
  const table: [RegExp, string][] = [
    [/Edg\//, "Microsoft Edge"],
    [/OPR\//, "Opera"],
    [/YaBrowser\//, "Yandex Browser"],
    [/SamsungBrowser\//, "Samsung Internet"],
    [/FxiOS\//, "Firefox"],
    [/Firefox\//, "Firefox"],
    [/CriOS\//, "Chrome"],
    [/Chrome\//, "Chrome"],
    [/Safari\//, "Safari"],
  ];
  for (const [re, name] of table) if (re.test(ua)) return name;
  return "";
}

/** Маркер активного beacio (расширение ставит его вместе с navigator.bluetooth) */
function hasBeacio(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator as { beacio?: unknown }).beacio !== "undefined";
}

export function BleWarningDialog({
  t,
  open,
  onOpenChange,
}: {
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { supported, recheckSupport } = usePrinter();
  const ios = useMemo(() => isIosLike(), []);
  const firefox = useMemo(() => isFirefox(), []);
  const browser = useMemo(() => browserName(), []);
  /* «Проверить снова» нажата, а Web Bluetooth так и не появился —
   * показываем развёрнутую подсказку, что ещё проверить */
  const [rechecked, setRechecked] = useState(false);
  const [beacioSeen, setBeacioSeen] = useState(false);

  /* Web Bluetooth появился (beacio включили на лету) — закрываем плашку */
  useEffect(() => {
    if (open && supported) onOpenChange(false);
  }, [open, supported, onOpenChange]);

  /* Плашку закрыли — сбрасываем результат прошлой проверки, чтобы при
   * следующем открытии подсказка не висела. Правим состояние прямо в
   * рендере (паттерн React для реакции на смену пропса): синхронный
   * setState в эффекте запрещён правилом react-hooks/set-state-in-effect */
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) setRechecked(false);
  }

  const handleRecheck = () => {
    setBeacioSeen(hasBeacio());
    if (recheckSupport()) {
      setRechecked(false);
      onOpenChange(false);
    } else {
      setRechecked(true);
    }
  };

  const steps = ios && open ? t("ble.stepsIos").split("\n") : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-3 rounded-xl sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BluetoothOff className="h-5 w-5 shrink-0 text-amber-500" />
            {t("ble.title")}
          </DialogTitle>
          <DialogDescription className="text-left text-sm leading-relaxed">
            {ios ? t("ble.descIos") : firefox ? t("ble.descFirefox") : t("ble.desc")}
            {browser && (
              <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                {t("ble.youUse", { name: browser })}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Шаги включения beacio — установка приложения только полдела */}
        {ios && steps.length > 0 && (
          <ol className="m-0 list-decimal space-y-1 rounded-lg bg-slate-50 py-2 pl-8 pr-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}

        {/* Проверка не удалась — объясняем, что ещё не сделано */}
        {rechecked && !supported && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {beacioSeen ? t("ble.beacioGrant") : t("ble.stillMissing")}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <a
            href={ios ? BEACIO_URL : CHROME_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <Globe className="h-4 w-4" />
            {ios ? t("ble.beacioBtn") : t("ble.chromeBtn")}
            <ExternalLink className="h-3.5 w-3.5 opacity-60" />
          </a>
          {ios && (
            <Button
              variant="outline"
              onClick={handleRecheck}
              className="h-10 rounded-lg"
            >
              <RefreshCw className="h-4 w-4" />
              {t("ble.checkBtn")}
            </Button>
          )}
          {ios && (
            <a
              href={BLUEFY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Globe className="h-4 w-4" />
              {t("ble.bluefyBtn")}
              <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            </a>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-lg"
          >
            {t("ble.close")}
          </Button>
          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            {t("ble.note")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
