"use client";
/**
 * Самоходный счётчик посещений для собственной PHP-админки (/admin/, v1.0.58).
 *
 • На первую загрузку страницы и затем раз в минуту, пока вкладка видима,
 *   отправляется компактный JSON-хит на /admin/hit.php (navigator.sendBeacon,
 *   fallback — fetch keepalive). Без cookies, без сторонних сетей: всё пишет
 *   локальный PHP-коллектор в admin/data/hits/*.jsonl.
 • ID посетителя (vid) — случайная строка в localStorage (не персональные
 *   данные); IP на сервере хранится только солёным хешем.
 • file:// (офлайн-копия) и не-HTTP протоколы не отправляют ничего.
 • На хостинге без /admin/ запрос молча не удаётся — на сайт не влияет.
 */
import React, { useEffect } from "react";

const VID_KEY = "mxw01_vid";
const PING_INTERVAL_MS = 60_000;
const MAX_PINGS = 240; /* ≈4 часа присутствия за сессию */

function visitorId(): string {
  try {
    let v = window.localStorage.getItem(VID_KEY) ?? "";
    if (!/^[0-9a-f]{8,32}$/.test(v)) {
      const bytes = new Uint8Array(8);
      const c = window.crypto;
      if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
      else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      v = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      window.localStorage.setItem(VID_KEY, v);
    }
    return v;
  } catch {
    return "0000000000000000";
  }
}

function sendSelfHit(type: "page" | "ping"): void {
  try {
    const proto = window.location.protocol;
    if (proto !== "http:" && proto !== "https:") return; /* офлайн-копия */
    const payload = JSON.stringify({
      type,
      vid: visitorId(),
      p: window.location.pathname.slice(0, 120),
      ref: document.referrer.slice(0, 200),
      lang: (navigator.language || "").slice(0, 12),
      w: window.innerWidth || 0,
      h: window.innerHeight || 0,
      tz: new Date().getTimezoneOffset(),
    });
    const url = "/admin/hit.php";
    if (typeof navigator.sendBeacon === "function") {
      /* text/plain — без preflight, PHP читает php://input как есть */
      if (navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }))) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload,
      keepalive: true,
      cache: "no-store",
    }).catch(() => {});
  } catch {
    /* телеметрия никогда не мешает работе сайта */
  }
}

export function SelfHit() {
  useEffect(() => {
    sendSelfHit("page");
    let pings = 0;
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible" && pings < MAX_PINGS) {
        pings += 1;
        sendSelfHit("ping");
      }
    }, PING_INTERVAL_MS);
    return () => window.clearInterval(iv);
  }, []);
  return null;
}
