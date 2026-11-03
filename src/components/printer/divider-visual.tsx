"use client";
/**
 * Визуал разделителя строк: встроенные стили (линия/пунктир/точки/двойная/
 * зигзаг) или пользовательский SVG-файл.
 *
 * Используется в двух местах:
 *  • карточка элемента на вкладке «Лента» (миниатюра в списке);
 *  • был также в DOM-превью LabelEditor — теперь лента рендерится холстом
 *    печати (tape.ts), где геометрия та же (text-fields.ts drawDivider).
 *
 * Геометрия зигзага повторяет canvas-отрисовку (text-fields.ts): тот же шаг
 * ZIGZAG_STEP и та же формула амплитуды, поэтому превью = результат печати.
 */
import type { DividerItem } from "@/lib/printer/types";
import { ZIGZAG_STEP } from "@/lib/printer/text-fields";

export function DividerVisual({ d }: { d: DividerItem }) {
  if (d.svg) {
    return (
      <img
        src={d.svg}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full object-contain"
      />
    );
  }

  const t = Math.max(1, Math.min(6, d.thickness));

  if (d.style === "double") {
    return (
      <div
        className="w-full"
        style={{
          borderTop: `${t}px solid #000`,
          borderBottom: `${t}px solid #000`,
          height: Math.max(t * 2 + 3, d.height),
        }}
      />
    );
  }

  if (d.style === "zigzag") {
    const w = Math.max(ZIGZAG_STEP, d.width);
    const h = Math.max(t * 2 + 2, d.height);
    const amp = Math.max(1, (h - t) / 2);
    const mid = h / 2;
    let path = `M 0 ${mid}`;
    let up = true;
    for (let px = ZIGZAG_STEP; px < w; px += ZIGZAG_STEP) {
      path += ` L ${px} ${up ? mid - amp : mid + amp}`;
      up = !up;
    }
    path += ` L ${w} ${mid}`;
    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden
      >
        <path d={path} fill="none" stroke="#000" strokeWidth={t} />
      </svg>
    );
  }

  const styleMap = { solid: "solid", dashed: "dashed", dotted: "dotted" } as const;
  return (
    <div
      className="w-full"
      style={{
        borderTopWidth: t,
        borderTopStyle: styleMap[d.style],
        borderTopColor: "#000",
      }}
    />
  );
}
