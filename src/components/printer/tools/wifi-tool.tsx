"use client";
/**
 * Инструмент «Wi-Fi»: этикетка с QR-кодом подключения к сети.
 * Payload по конвенции WIFI:T:…;S:…;P:…;H:true;; — камера телефона
 * предлагает подключение без ручного ввода пароля.
 * Поля карточки ленты: данные приходят из ToolItem (value/onChange).
 */
import React from "react";
import type { Translator } from "@/lib/printer/i18n";
import type { WifiToolData } from "@/lib/printer/types";
import { ToolField, ToolInput, ToolSelect, ToolToggle } from "./tools-shared";
import type { WifiEnc } from "@/lib/printer/tools-data";

export function WifiFields({
  value,
  onChange,
  t,
}: {
  value: WifiToolData;
  onChange: (patch: Partial<WifiToolData>) => void;
  t: Translator;
}) {
  return (
    <div className="space-y-3">
      <ToolField label={t("tool.wifi.ssid")}>
        <ToolInput
          value={value.ssid}
          onChange={(e) => onChange({ ssid: e.target.value })}
          placeholder={t("tool.wifi.ssidPh")}
          aria-label={t("tool.wifi.ssid")}
          autoComplete="off"
        />
      </ToolField>
      <ToolField label={t("tool.wifi.enc")}>
        <ToolSelect
          value={value.enc}
          onChange={(v) => onChange({ enc: v as WifiEnc })}
          ariaLabel={t("tool.wifi.enc")}
          options={[
            { value: "wpa", label: "WPA / WPA2 / WPA3" },
            { value: "wep", label: "WEP" },
            { value: "nopass", label: t("tool.wifi.open") },
          ]}
        />
      </ToolField>
      {value.enc !== "nopass" && (
        <ToolField label={t("tool.wifi.password")}>
          <ToolInput
            value={value.password}
            onChange={(e) => onChange({ password: e.target.value })}
            placeholder={t("tool.wifi.passwordPh")}
            aria-label={t("tool.wifi.password")}
            autoComplete="off"
          />
        </ToolField>
      )}
      <ToolToggle label={t("tool.wifi.hidden")} checked={value.hidden} onChange={(v) => onChange({ hidden: v })} />
      <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">{t("tool.wifi.hint")}</p>
    </div>
  );
}
