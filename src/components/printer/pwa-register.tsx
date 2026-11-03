"use client";
/**
 * Регистрация service worker (PWA). Только в продакшене: в dev-режиме SW
 * не регистрируется, чтобы кэш не мешал горячей разработке.
 */
import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW недоступен (например, небезопасный контекст) — не критично */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
