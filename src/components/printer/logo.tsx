"use client";
/**
 * Логотип MXW01 Web Terminal — принтер со значком Bluetooth (SVG из брендбука
 * проекта). Используется в шапке, футере и как источник фавикона
 * (public/logo.svg — тот же рисунок).
 *
 * Градиенты получают уникальные id на экземпляр (useId) — на странице
 * несколько логотипов, и url(#id) не должен конфликтовать.
 */
import { useId } from "react";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradId = `${uid}grad`;
  const shineId = `${uid}shine`;
  return (
    <svg
      viewBox="0 0 128 128"
      aria-hidden
      focusable="false"
      className={cn("h-6 w-6 shrink-0", className)}
    >
      {/* Фон */}
      <rect width="128" height="128" rx="24" fill="#EEF2FF" />

      {/* Корпус принтера */}
      <rect x="24" y="46" width="80" height="54" rx="10" fill="#4F46E5" />
      <rect
        x="24"
        y="46"
        width="80"
        height="54"
        rx="10"
        fill={`url(#${gradId})`}
        opacity="0.4"
      />

      {/* Верхняя крышка */}
      <rect x="32" y="36" width="64" height="16" rx="6" fill="#6366F1" />

      {/* Слот выхода бумаги */}
      <rect x="40" y="56" width="48" height="6" rx="3" fill="#1E1B4B" opacity="0.6" />

      {/* Бумага */}
      <path d="M44 60 h40 v18 h-40 z" fill="#FFFFFF" />
      <path d="M44 60 h40 v18 h-40 z" fill={`url(#${shineId})`} opacity="0.5" />
      <line x1="50" y1="66" x2="78" y2="66" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round" />
      <line x1="50" y1="71" x2="72" y2="71" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round" />

      {/* Кнопка питания */}
      <circle cx="90" cy="82" r="4" fill="#10B981" />
      <circle cx="90" cy="82" r="4" fill="none" stroke="#064E3B" strokeWidth="0.5" opacity="0.5" />

      {/* Индикатор Bluetooth */}
      <circle cx="38" cy="82" r="4" fill="#60A5FA" />
      <circle cx="38" cy="82" r="4" fill="none" stroke="#1E3A8A" strokeWidth="0.5" opacity="0.5" />

      {/* Значок Bluetooth */}
      <g transform="translate(64, 20) scale(0.9)">
        <circle r="16" fill="#3B82F6" />
        <path
          d="M0 -9 L0 9 M0 -9 L6 -3 L-6 3 M0 9 L6 3 L-6 -3"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Декоративный отблеск */}
      <rect x="28" y="50" width="72" height="2" rx="1" fill="#FFFFFF" opacity="0.3" />

      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={shineId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#A5B4FC" />
        </linearGradient>
      </defs>
    </svg>
  );
}
