"use client";
/**
 * Текстовое поле с кнопкой эмодзи справа внутри (как в мессенджерах).
 *
 *  • кнопка-смайл в правом нижнем углу поля открывает поповер-каталог
 *    с категориями: смайлы / жесты / сердца / символы / животные / еда / разное;
 *  • выбранный эмодзи вставляется в позицию курсора (или вместо выделения),
 *    каретка встаёт сразу после вставки — можно добавлять несколько подряд;
 *  • поповер закрывается кликом вне, Esc или повторным нажатием кнопки;
 *    после выбора остаётся открытым; у нижнего края экрана раскрывается вверх;
 *  • поле растёт по содержимому (логика бывшего AutoTextarea перенесена сюда);
 *  • эмодзи печатаются полутоновым дизерингом (см. text-fields.ts,
 *    emoji-halftone.ts); превью 1:1 показывает их цветными — макет и позиции
 *    совпадают с печатью, растр появляется на холсте печати;
 *
 * Только UI-слой: на драйвер и отправку печати не влияет.
 */
import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Translator } from "@/lib/printer/i18n";

/** Каталог эмодзи: иконка категории + набор (без внешних зависимостей —
 *  работает в офлайн-сборке) */
const CATEGORIES: { icon: string; emojis: string[] }[] = [
  {
    icon: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃",
      "😉", "😌", "😍", "🥰", "😘", "😗", "😚", "😋", "😛", "😝", "😜", "🤪",
      "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟",
      "😕", "🙁", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡",
      "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "🤗", "🤔", "🤭", "🤫", "😶",
      "😐", "😬", "🙄", "😯", "😮", "😲", "🥱", "😴", "🤤", "😪", "🤢", "🤮",
      "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "💀", "🤡", "👻", "👽", "🤖",
      "💩",
    ],
  },
  {
    icon: "👋",
    emojis: [
      "👋", "🤚", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙",
      "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏",
      "🙌", "👐", "🤲", "🤝", "🙏", "💪", "✍️", "🤳",
    ],
  },
  {
    icon: "❤️",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕",
      "💞", "💓", "💗", "💖", "💘", "💝", "💟", "💌",
    ],
  },
  {
    icon: "⭐",
    emojis: [
      "⭐", "🌟", "✨", "💫", "⚡", "🔥", "💥", "❄️", "🌈", "☀️", "🌙", "💧",
      "🎵", "🎶", "✅", "❌", "❎", "❗", "❓", "💯", "🔔", "⚠️", "🚫", "🚨",
      "💤", "👀", "💬", "💡", "🔑", "🔒", "📌", "🏷️", "💰", "💵", "💳", "⏰",
      "📅", "🛒", "♻️", "➡️", "⬅️", "⬆️", "⬇️",
    ],
  },
  {
    icon: "🐶",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
      "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🐤", "🦆", "🦉", "🦄", "🐝", "🦋",
      "🐌", "🐢", "🐍", "🐙", "🦀", "🐠", "🐟", "🐬", "🐳", "🦈", "🐊", "🦓",
      "🐘", "🦒", "🐐", "🦌", "🐕", "🐈", "🦜", "🦚",
    ],
  },
  {
    icon: "🍎",
    emojis: [
      "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍒", "🍑", "🥭",
      "🍍", "🥝", "🍅", "🥑", "🥦", "🌽", "🥕", "🍞", "🥐", "🧀", "🍳", "🥓",
      "🍗", "🌭", "🍔", "🍟", "🍕", "🥪", "🌮", "🌯", "🥗", "🍝", "🍜", "🍣",
      "🍱", "🍤", "🍙", "🍚", "🍦", "🍰", "🎂", "🧁", "🍭", "🍬", "🍫", "🍿",
      "🍩", "🍪", "☕", "🍵", "🥤", "🍺", "🍷", "🥂", "🍾",
    ],
  },
  {
    icon: "🎁",
    emojis: [
      "🎁", "🎈", "🎊", "🎉", "🏆", "🥇", "🥈", "🥉", "🏅", "⚽", "🏀", "🎾",
      "🎱", "🎮", "🎲", "🎯", "🎸", "🎹", "🎤", "🎧", "🎨", "🚗", "🚕", "🚌",
      "🚲", "✈️", "🚀", "⛵", "🏠", "🏪", "💼", "📱", "💻", "⌚", "📷", "🔍",
      "🔧", "💊", "🌸", "🌺", "🌻", "🌹", "🌴", "🌵", "🍀", "🌍",
    ],
  },
];

/** Ориентировочная высота поповера, px — для решения «вверх или вниз» */
const PANEL_EST_HEIGHT = 280;

export function EmojiTextarea({
  value,
  onValueChange,
  growKey,
  className,
  t,
  ...props
}: Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "className"
> & {
  value: string;
  onValueChange: (v: string) => void;
  /** Ключ роста: меняется при смене текста/шрифта → пересчёт высоты */
  growKey: string;
  className?: string;
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [cat, setCat] = useState(0);

  // Рост поля по содержимому: перенос строк, смена шрифта, resize окна
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    grow();
    window.addEventListener("resize", grow);
    return () => window.removeEventListener("resize", grow);
  }, [growKey]);

  // Закрытие поповера: клик вне (capture — раньше прочих обработчиков) и Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Вставить эмодзи в позицию курсора (или вместо выделения) */
  const insertEmoji = (emoji: string) => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    // Синхронный коммит: к моменту установки каретки DOM уже с новым значением
    flushSync(() => {
      onValueChange(value.slice(0, start) + emoji + value.slice(end));
    });
    el.focus();
    const pos = start + emoji.length;
    el.setSelectionRange(pos, pos);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const toggle = () => {
    if (!open && btnRef.current) {
      // Если снизу мало места, а сверху есть — раскрываемся вверх
      const r = btnRef.current.getBoundingClientRect();
      setDropUp(
        r.bottom + PANEL_EST_HEIGHT > window.innerHeight &&
          r.top > PANEL_EST_HEIGHT
      );
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        {...props}
        className={cn("block w-full", className)}
      />
      <button
        ref={btnRef}
        type="button"
        title={t("tt.emojiBtn")}
        aria-label={t("tt.emojiBtn")}
        aria-expanded={open}
        // mousedown preventDefault — фокус и каретка остаются в поле
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className={cn(
          "absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300",
          open &&
            "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
        )}
      >
        <Smile className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("tt.emojiBtn")}
          className={cn(
            "absolute right-0 z-30 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900",
            dropUp ? "bottom-full mb-1" : "top-full mt-1"
          )}
        >
          {/* Категории */}
          <div className="flex items-center gap-0.5">
            {CATEGORIES.map((c, i) => (
              <button
                key={c.icon}
                type="button"
                title={c.icon}
                aria-label={c.icon}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCat(i)}
                className={cn(
                  "h-7 flex-1 rounded-md text-base leading-none transition-colors",
                  i === cat
                    ? "bg-slate-900/10 dark:bg-white/15"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
              >
                {c.icon}
              </button>
            ))}
          </div>
          {/* Сетка эмодзи */}
          <div className="mt-1 grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
            {CATEGORIES[cat].emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={emoji}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertEmoji(emoji)}
                className="flex h-8 w-full items-center justify-center rounded-md text-xl leading-none transition-transform hover:bg-slate-100 active:scale-90 dark:hover:bg-slate-800"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
