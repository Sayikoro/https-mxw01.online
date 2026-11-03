"use client";
/**
 * ЛЕНТА — drag&drop-концепция редактора (вместо вкладки «Текст»).
 *
 *  • Палитра слева: «Блоки» (текст/разделитель/картинка/ценник/линейка)
 *    и «Генераторы» (QR, Wi-Fi, чек-лист, чек, годность, нумерация,
 *    календарь, привычки — бывшая вкладка «Инструменты»). Инструмент
 *    перетаскивается на ленту — элемент встаёт в место броска; клик
 *    добавляет его в конец ленты.
 *  • Элементы идут ПОТОКОМ в порядке списка: у каждого своя карточка
 *    с полями ввода (появляется сразу после добавления); порядок меняется
 *    перетаскиванием карточек за ручку (мышь + палец). У ценника — список
 *    тегов с CSV-импортом/экспортом (как на вкладке «Ценник»), у генераторов
 *    — их форма прямо в карточке; данные хранятся в самом элементе.
 *  • Лента — бумага 58 мм (384 px печати, 48 мм зоны печати = 203 DPI);
 *    страница не длиннее 90 мм (720 px). Контент, не влезающий в страницу,
 *    автоматически переносится на новую — она появляется ниже текущей
 *    (текст переносится построчно, генераторы — по границам фрагментов).
 *  • Превью страницы = холст печати с дизерингом (см. tape.ts): текст —
 *    суперсэмплинг + бинаризация, эмодзи — полутон Байера, картинки —
 *    дизеринг драйвера, генераторы — своя бинаризация. Что видно в превью —
 *    то и уйдёт на бумагу.
 *  • Разделитель умеет «Поверх текста» — зачёркивает предыдущий блок,
 *    не занимая вертикального места.
 *  • Печать: каждая страница — отдельное задание printCanvas (с копиями).
 *    Драйвер и отправка печати не изменены.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePrinter } from "@/lib/printer/printer-context";
import { useUsbPrinter } from "@/lib/printer/usb/usb-printer-context";
import { useHprtPrinter } from "@/lib/printer/hprt/hprt-printer-context";
import {
  DIVIDER_STYLES,
  FONT_OPTIONS,
  PTLIST_TAGS_MAX,
  PRINTER_HEAD_WIDTH,
  PX_PER_MM,
  RULER_MM_MAX,
  RULER_MM_MIN,
  TAPE_PAGE_MAX_PX,
  TAPE_TOOL_IDS,
  TEXT_FRAME_STYLES,
  createId,
  isDivider,
  isImage,
  isPricetag,
  isPricetagList,
  isRuler,
  isTool,
} from "@/lib/printer/types";
import type {
  CalendarToolData,
  ChecklistToolData,
  DatesToolData,
  DividerItem,
  DividerStyle,
  HabitsToolData,
  ImageItem,
  LabelItem,
  NumbersToolData,
  PricetagItem,
  PricetagListItem,
  PricetagListTag,
  QrToolData,
  ReceiptToolData,
  ReplacementToolData,
  RulerItem,
  TapeToolData,
  TapeToolId,
  TextAlignment,
  TextFieldItem,
  TextFrameStyle,
  ToolItem,
  WifiToolData,
} from "@/lib/printer/types";
import { notePrintedMm } from "@/lib/printer/tape-counter";
import {
  measurePricetagItem,
  makePricetagListTag,
  normalizePricetagListItemTags,
  pricetagNameSize,
  pricetagOldSize,
  ptlistFromLegacyPricetag,
  OLD_LINE_RE,
  PRICE_LINE_RE,
} from "@/lib/printer/tape-pricetag";
import {
  isKnownToolId,
  makeToolItemBase,
  sanitizeToolData,
  sanitizeToolTypo,
  toolChunksHeightPx,
  toolItemChunks,
} from "@/lib/printer/tape-tools";
import { importPricetagsFromCsv } from "@/lib/printer/pricetags";
import { usePreviewQuality } from "@/lib/printer/preview-quality";
import { SUPER_SAMPLE } from "@/lib/printer/canvas-quality";
import {
  builtinDividerHeight,
  ensureDividerImages,
  measureField,
  preloadDividerImages,
} from "@/lib/printer/text-fields";
import {
  PAGE_PAD_BOTTOM,
  PAGE_PAD_TOP,
  ensureTapeImages,
  fitImageSize,
  indicatorYAt,
  insertIndexAt,
  layoutTape,
  preloadTapeImages,
  renderTapePage,
} from "@/lib/printer/tape";
import type { TapePage } from "@/lib/printer/tape";
import { autoTone, toGray } from "@/lib/printer/image-processing";
import { renderCopies } from "@/lib/printer/copies";
import type { CopiesSettings } from "@/lib/printer/copies";
import { clampCopies, COPIES_MAX, DEFAULT_COPIES } from "@/lib/printer/copies";
import type { Lang, Translator } from "@/lib/printer/i18n";
import { useLabelSize, labelFixedHeightPx } from "@/lib/printer/label-size";
import { DividerVisual } from "./divider-visual";
import { EmojiTextarea } from "./emoji-textarea";
import { QrFields } from "./tools/qr-tool";
import { WifiFields } from "./tools/wifi-tool";
import { ChecklistFields } from "./tools/checklist-tool";
import { ReceiptFields } from "./tools/receipt-tool";
import { DatesFields } from "./tools/dates-tool";
import { ReplacementFields } from "./tools/replacement-tool";
import { NumbersFields } from "./tools/numbers-tool";
import { CalendarFields } from "./tools/calendar-tool";
import { HabitsFields } from "./tools/habits-tool";
import {
  AlignGroup,
  FlatBanner,
  IconBtn,
  LabelSizeControl,
  LeftPanel,
  Pill,
  PreviewBody,
  PreviewHeader,
  PrintDock,
  RightPanel,
  SectionHeader,
  SizeSelect,
  Workspace,
} from "./shell";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  BadgePercent,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Copy,
  FileDown,
  FileUp,
  GripVertical,
  Hash,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  ListChecks,
  Minus,
  Plus,
  QrCode,
  Receipt,
  RectangleHorizontal,
  Replace,
  RotateCcw,
  Ruler,
  Save,
  SeparatorHorizontal,
  Sparkles,
  Strikethrough,
  Tag,
  Trash2,
  Type,
  Upload,
  Wifi,
} from "lucide-react";

const LS_KEY = "mxw01-text-fields";

/** Максимальный размер SVG-файла разделителя (защита localStorage) */
const SVG_MAX_BYTES = 100 * 1024;
/** Максимальный размер картинки ленты (защита localStorage) */
const IMG_MAX_BYTES = 2 * 1024 * 1024;

/** MIME-тип переноса инструментов на ленту */
const TOOL_MIME = "application/x-mxw01-tool";
/** Инструменты палитры: блоки + генераторы (бывшая вкладка «Инструменты») */
type ToolType = "text" | "divider" | "image" | "pricetag" | "ruler" | TapeToolId;
const TOOL_TYPES: readonly ToolType[] = ["text", "divider", "image", "pricetag", "ruler", ...TAPE_TOOL_IDS];

/** Пресеты ширины разделителя, px */
const DIVIDER_WIDTHS = [352, 240, 160] as const;

/** Пресеты масштаба текста генератора (ToolTypo.scale) */
const TOOL_SCALES = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2] as const;

/** Подстановки данных товара в строках ценника — те же, что на вкладке «Ценник» */
const PT_PLACEHOLDERS = [
  { ph: "{name}", key: "pt.chip.name" },
  { ph: "{price}", key: "pt.chip.price" },
  { ph: "{old}", key: "pt.chip.old" },
  { ph: "{sku}", key: "pt.chip.sku" },
  { ph: "{qr}", key: "pt.chip.qr" },
  { ph: "{barcode}", key: "pt.chip.barcode" },
] as const;

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Привести элемент из localStorage к валидному виду (или отбросить) */
function normalizeItem(raw: unknown): LabelItem | null {
  if (!raw || typeof raw !== "object") return null;
  const it = raw as Record<string, unknown>;
  if (typeof it.id !== "string" || !it.id) return null;

  if (it.kind === "divider") {
    const style: DividerStyle = DIVIDER_STYLES.includes(it.style as DividerStyle)
      ? (it.style as DividerStyle)
      : "solid";
    const width = Math.max(8, Math.min(PRINTER_HEAD_WIDTH, Number(it.width) || 352));
    const thickness = Math.max(1, Math.min(6, Number(it.thickness) || 2));
    const svg =
      typeof it.svg === "string" && it.svg.startsWith("data:image") && it.svg.length <= 300_000
        ? it.svg
        : undefined;
    const ratio = Number(it.ratio);
    const height = svg
      ? Math.max(2, Math.min(160, Number(it.height) || Math.round(width * (ratio > 0 ? ratio : 0.05))))
      : builtinDividerHeight(style, thickness);
    return {
      id: it.id,
      kind: "divider",
      x: Math.max(0, Number(it.x) || 0),
      y: 0,
      width,
      thickness,
      style,
      height,
      overlay: Boolean(it.overlay),
      ...(svg ? { svg, ...(ratio > 0 ? { ratio } : {}) } : {}),
    };
  }

  if (it.kind === "image") {
    const src =
      typeof it.src === "string" && it.src.startsWith("data:image") && it.src.length <= 2_600_000
        ? it.src
        : null;
    if (!src) return null;
    const width = clampNum(it.width, 8, PRINTER_HEAD_WIDTH, PRINTER_HEAD_WIDTH);
    const height = clampNum(it.height, 2, TAPE_PAGE_MAX_PX, 100);
    const dither = (["steinberg", "bayer", "atkinson", "none"] as const).includes(
      it.dither as "steinberg"
    )
      ? (it.dither as ImageItem["dither"])
      : "steinberg";
    return {
      id: it.id,
      kind: "image",
      src,
      x: clampNum(it.x, 0, PRINTER_HEAD_WIDTH - width, 0),
      y: 0,
      width,
      height,
      dither,
      brightness: clampNum(it.brightness, -100, 100, 0),
      contrast: clampNum(it.contrast, -100, 100, 0),
    };
  }

  if (it.kind === "ruler") {
    return {
      id: it.id,
      kind: "ruler",
      x: 64,
      y: 0,
      lengthMm: clampNum(it.lengthMm, RULER_MM_MIN, RULER_MM_MAX, 50),
    };
  }

  if (it.kind === "tool") {
    // Генератор (бывшая вкладка «Инструменты»): данные формы чинятся
    // по схеме конкретного инструмента; неизвестный — отбрасывается
    if (!isKnownToolId(it.tool)) return null;
    return {
      id: it.id,
      kind: "tool",
      x: 0,
      y: 0,
      tool: it.tool,
      data: sanitizeToolData(it.tool, it.data),
      typo: sanitizeToolTypo(it.typo),
    };
  }

  if (it.kind === "ptlist") {
    // Список ценников: теги чинятся по одному, типографика зажимается
    const align2 = (v: unknown): TextAlignment | undefined =>
      v === "left" || v === "center" || v === "right" ? v : undefined;
    const fontSize = clampNum(it.fontSize, 16, 96, 48);
    return {
      id: it.id,
      kind: "ptlist",
      x: clampNum(it.x, 0, PRINTER_HEAD_WIDTH - 48, 16),
      y: 0,
      tags: normalizePricetagListItemTags(it.tags),
      fontSize,
      frame: Boolean(it.frame),
      nameSize:
        it.nameSize == null ? undefined : clampNum(it.nameSize, 12, 96, pricetagNameSize(fontSize)),
      extraSize: it.extraSize == null ? undefined : clampNum(it.extraSize, 8, 72, 24),
      oldPriceSize:
        it.oldPriceSize == null ? undefined : clampNum(it.oldPriceSize, 10, 96, pricetagOldSize(fontSize)),
      nameAlign: align2(it.nameAlign),
      priceAlign: align2(it.priceAlign),
      extraAlign: align2(it.extraAlign),
      fontFamily: typeof it.fontFamily === "string" ? it.fontFamily : undefined,
      nameBold: typeof it.nameBold === "boolean" ? it.nameBold : undefined,
      priceBold: typeof it.priceBold === "boolean" ? it.priceBold : undefined,
    };
  }

  if (it.kind === "pricetag") {
    // Одиночные ценники старых версий мигрируют в список (ptlist):
    // поля товара — в один тег, типографика — на уровень элемента
    return ptlistFromLegacyPricetag(it, it.id);
  }

  // Текстовое поле (у старых записей поле kind отсутствует);
  // в потоке важен только горизонтальный отступ x — y теперь выводится
  const lh = Number(it.lineHeight);
  const frame = TEXT_FRAME_STYLES.includes(it.frame as TextFrameStyle)
    ? (it.frame as TextFrameStyle)
    : undefined;
  return {
    id: it.id,
    text: typeof it.text === "string" ? it.text : "",
    x: clampNum(it.x, 0, PRINTER_HEAD_WIDTH - 8, 16),
    y: 0,
    fontSize: Number(it.fontSize) || 28,
    bold: Boolean(it.bold),
    italic: Boolean(it.italic),
    fontFamily: typeof it.fontFamily === "string" ? it.fontFamily : "sans-serif",
    underline: Boolean(it.underline),
    strike: Boolean(it.strike),
    upper: Boolean(it.upper),
    lineHeight:
      Number.isFinite(lh) && [1, 1.25, 1.5, 2].includes(lh) ? lh : undefined,
    frame,
  };
}

function loadInitialFields(defaultText: string): LabelItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const items = parsed.map(normalizeItem).filter((it): it is LabelItem => it !== null);
        if (items.length) return items;
      }
    }
  } catch {
    /* повреждённый localStorage — начинаем с примера */
  }
  return [
    { id: createId(), text: defaultText, x: 16, y: 0, fontSize: 32, bold: true, fontFamily: "sans-serif" },
    {
      id: createId(),
      kind: "divider",
      x: 16,
      y: 0,
      width: 352,
      thickness: 2,
      style: "solid",
      height: builtinDividerHeight("solid", 2),
    },
  ];
}

/** Текущее выравнивание строки — выводим из её позиции (лево/центр/право) */
function currentAlign(f: TextFieldItem): TextAlignment {
  const m = measureField(f);
  const centerX = Math.round((PRINTER_HEAD_WIDTH - m.width) / 2);
  const rightX = Math.max(0, PRINTER_HEAD_WIDTH - m.width - 16);
  if (Math.abs(f.x - centerX) <= 2) return "center";
  if (Math.abs(f.x - rightX) <= 2) return "right";
  return "left";
}

const selectCls =
  "h-7 min-w-0 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:disabled:opacity-40";

/* Поля ввода карточки ценника — та же гамма, что у селектов/текстарии */
const inputCls =
  "h-7 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none placeholder:text-slate-300 hover:border-slate-300 focus:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-600 dark:hover:border-slate-600 dark:focus:border-slate-100";

/**
 * Поля формы генератора по его id: единая точка диспетчеризации.
 * Данные живут в ToolItem ленты — формы получают value/onChange.
 */
function ToolFieldsById({
  tool,
  data,
  onChange,
  t,
  lang,
}: {
  tool: TapeToolId;
  data: TapeToolData;
  onChange: (patch: object) => void;
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
  lang: Lang;
}) {
  switch (tool) {
    case "qr":
      return <QrFields t={t} value={data as QrToolData} onChange={onChange} />;
    case "wifi":
      return <WifiFields t={t} value={data as WifiToolData} onChange={onChange} />;
    case "checklist":
      return <ChecklistFields t={t} value={data as ChecklistToolData} onChange={onChange} />;
    case "receipt":
      return <ReceiptFields t={t} value={data as ReceiptToolData} onChange={onChange} />;
    case "dates":
      return <DatesFields t={t} lang={lang} value={data as DatesToolData} onChange={onChange} />;
    case "replace":
      return <ReplacementFields t={t} lang={lang} value={data as ReplacementToolData} onChange={onChange} />;
    case "numbers":
      return <NumbersFields t={t} value={data as NumbersToolData} onChange={onChange} />;
    case "calendar":
      return <CalendarFields t={t} lang={lang} value={data as CalendarToolData} onChange={onChange} />;
    case "habits":
      return <HabitsFields t={t} lang={lang} value={data as HabitsToolData} onChange={onChange} />;
  }
}

/** Метаданные генератора: иконка, заголовок и краткая сводка для шапки карточки */
function toolCardMeta(
  tool: TapeToolId,
  data: TapeToolData,
  t: Translator
): { Icon: React.ComponentType<{ className?: string }>; title: string; summary: string } {
  switch (tool) {
    case "qr": {
      const d = data as QrToolData;
      return { Icon: QrCode, title: t("tool.qr.title"), summary: d.text.trim() };
    }
    case "wifi": {
      const d = data as WifiToolData;
      return { Icon: Wifi, title: t("tool.wifi.title"), summary: d.ssid.trim() };
    }
    case "checklist": {
      const d = data as ChecklistToolData;
      const done = d.items.filter((it) => it.text.trim()).length;
      return {
        Icon: ListChecks,
        title: t("tool.checklist.title"),
        summary: done ? t("ptl.badgeItems", { n: done }) : "",
      };
    }
    case "receipt": {
      const d = data as ReceiptToolData;
      return {
        Icon: Receipt,
        title: t("tool.receipt.title"),
        summary: d.shop.trim() || t("ptl.badgePositions", { n: d.items.length }),
      };
    }
    case "dates": {
      const d = data as DatesToolData;
      return { Icon: CalendarClock, title: t("tool.dates.title"), summary: d.name.trim() };
    }
    case "numbers": {
      const d = data as NumbersToolData;
      return { Icon: Hash, title: t("tool.numbers.title"), summary: t("ptl.badgeItems", { n: d.count }) };
    }
    case "calendar": {
      const d = data as CalendarToolData;
      return {
        Icon: CalendarDays,
        title: t("tool.calendar.title"),
        summary: `${String(d.month).padStart(2, "0")}.${d.year}`,
      };
    }
    case "habits": {
      const d = data as HabitsToolData;
      const named = d.habits.filter((h) => h.trim()).length;
      return {
        Icon: LayoutGrid,
        title: t("tool.habits.title"),
        summary: named ? t("ptl.badgeItems", { n: named }) : "",
      };
    }
    case "replace": {
      const d = data as ReplacementToolData;
      return { Icon: Replace, title: t("tool.replace.title"), summary: d.name.trim() };
    }
  }
}

/* Дублировать + Удалить — правый нижний угол карточки, одинаково у всех типов */
function CornerActions({
  dupLabel,
  delLabel,
  onDuplicate,
  onRemove,
}: {
  dupLabel: string;
  delLabel: string;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="absolute bottom-1 right-1 z-10 flex items-center gap-0.5">
      <button
        type="button"
        title={dupLabel}
        aria-label={dupLabel}
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title={delLabel}
        aria-label={delLabel}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-500 dark:hover:bg-red-950 dark:hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Превью страницы: холст печати с дизерингом                           */
/* ------------------------------------------------------------------ */

function PageCanvas({
  page,
  version,
  t,
  lang,
}: {
  page: TapePage;
  version: number;
  t: Translator;
  lang: Lang;
}) {
  // - Текст — только через пропсы: useI18n в компонентах не вызывается -
  // Качество превью: «Быстрое» рисует в 1× (слабые телефоны), «Точное» — 4×.
  // Печать и сохранение картинки всегда 4× — качество на них не влияет.
  const { quality } = usePreviewQuality();
  const scale = quality === "fast" ? 1 : SUPER_SAMPLE;
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Небольшой дебаунс: при вводе текста перерисовка не обязана быть
    // мгновенной, зато не спорит с вводом за главный поток
    const timer = window.setTimeout(() => {
      if (cancelled || !ref.current) return;
      try {
        renderTapePage(ref.current, page, { t, lang }, scale);
      } catch {
        /* холст мог быть уже размонтирован — не критично */
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [page, version, t, lang, scale]);

  return (
    <canvas
      ref={ref}
      width={PRINTER_HEAD_WIDTH}
      height={page.height}
      style={{ width: PRINTER_HEAD_WIDTH, imageRendering: "pixelated" }}
      className="block h-auto max-w-full"
      aria-label={t("shell.preview")}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Вкладка «Лента»                                                      */
/* ------------------------------------------------------------------ */

export function TapeTab({ t, lang }: { t: Translator; lang: Lang }) {
  const { status, printCanvas, connect } = usePrinter();
  const { transport, printCanvas: printUsb } = useUsbPrinter();
  const { printCanvas: printHprt } = useHprtPrinter();
  const { toast } = useToast();

  // Перевод/локаль для генераторов: передаются в раскладку и рендер печати
  const tapeI18n = useMemo(() => ({ t, lang }), [t, lang]);

  // Высота этикетки: «Авто» (страницы растут под содержимое до 90 мм) или
  // фиксированная в мм (типовые 30/40/50/90 или своё) — из «Настроек»;
  // изменения из шапки приходят событием подписки useLabelSize
  const [labelSize] = useLabelSize();
  const fixedPageHeight = labelFixedHeightPx(labelSize);

  const [items, setItems] = useState<LabelItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Раскрытый тег списка ценников (какая карточка и номер тега) */
  const [ptOpenTag, setPtOpenTag] = useState<{ id: string; index: number } | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [dragFieldId, setDragFieldId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ page: number; y: number } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [copies, setCopies] = useState<CopiesSettings>(DEFAULT_COPIES);
  const [assetVersion, setAssetVersion] = useState(0);

  const addCounterRef = useRef(0);
  const loadedRef = useRef(false);
  // Ручки перетаскивания карточек списка (drag & drop reorder)
  const fieldRowsRef = useRef<Map<string, HTMLElement>>(new Map());
  const fieldDragRef = useRef<{ id: string } | null>(null);
  // Загрузка файлов: свой SVG-разделитель, картинка ленты и CSV-ценники
  const svgInputRef = useRef<HTMLInputElement | null>(null);
  const svgTargetRef = useRef<string | null>(null);
  const imgInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageIndexRef = useRef<number | null>(null);
  const ptCsvInputRef = useRef<HTMLInputElement | null>(null);
  const csvTargetIdRef = useRef<string | null>(null);

  const bump = useCallback(() => setAssetVersion((v) => v + 1), []);

  useEffect(() => {
    const initial = loadInitialFields(t("tt.defaultText"));
    setItems(initial);
    setSelectedId(initial[0]?.id ?? null);
    loadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(items));
    } catch {
      /* переполнение localStorage (крупные картинки) — не критично */
    }
  }, [items]);

  // Прогрев картинок: свои SVG-разделители и растр картинок ленты
  useEffect(() => {
    preloadDividerImages(items, bump);
    preloadTapeImages(items, bump);
  }, [items, bump]);

  /** Компоновка ленты: страницы фиксированной высоты (или ≤ 90 мм) + позиции */
  const layout = useMemo(
    () =>
      layoutTape(items, {
        ...(fixedPageHeight ? { fixedPageHeight } : {}),
        i18n: tapeI18n,
      }),
    [items, fixedPageHeight, tapeI18n]
  );

  /* ---------------------- Добавление инструментов ---------------------- */

  const makeNewText = useCallback((): TextFieldItem => {
    addCounterRef.current += 1;
    const n = addCounterRef.current;
    return {
      id: createId(),
      text: n === 1 ? t("tt.newText") : t("tt.newTextN", { n }),
      x: 16,
      y: 0,
      fontSize: 28,
      bold: false,
      fontFamily: "sans-serif",
    };
  }, [t]);

  const makeNewDivider = useCallback(
    (): DividerItem => ({
      id: createId(),
      kind: "divider",
      x: 16,
      y: 0,
      width: 352,
      thickness: 2,
      style: "solid",
      height: builtinDividerHeight("solid", 2),
    }),
    []
  );

  const makeNewPtlist = useCallback((): PricetagListItem => {
    addCounterRef.current += 1;
    const n = addCounterRef.current;
    return {
      id: createId(),
      kind: "ptlist",
      x: 16,
      y: 0,
      tags: [makePricetagListTag(n === 1 ? t("tape.ptNewName") : t("tape.ptNewNameN", { n }), "100")],
      // Ценники = вкладка «Ценник»: макет строками с подстановками, рамка
      // включена (дефолт вкладки), пропорции кеглей как в DEFAULT_STYLE
      fontSize: 48,
      frame: true,
      nameSize: 36,
      oldPriceSize: 22,
      extraSize: 24,
    };
  }, [t]);

  const makeNewRuler = useCallback((): RulerItem => {
    return {
      id: createId(),
      kind: "ruler",
      x: 64,
      y: 0,
      lengthMm: 50,
    };
  }, []);

  const openImagePicker = useCallback((index: number) => {
    pendingImageIndexRef.current = index;
    imgInputRef.current?.click();
  }, []);

  const addTool = useCallback(
    (tool: ToolType, index?: number) => {
      const at = Math.max(0, Math.min(index ?? items.length, items.length));
      if (tool === "image") {
        openImagePicker(at);
        return;
      }
      let el: LabelItem;
      if (tool === "text") el = makeNewText();
      else if (tool === "divider") el = makeNewDivider();
      else if (tool === "ruler") el = makeNewRuler();
      else if (tool === "pricetag") el = makeNewPtlist();
      else
        el = {
          id: createId(),
          kind: "tool",
          ...makeToolItemBase(tool),
        } as ToolItem;
      setItems((prev) => {
        const next = [...prev];
        next.splice(Math.min(at, prev.length), 0, el);
        return next;
      });
      setSelectedId(el.id);
      // Генераторы и списки ценников раскрываются сразу: их форма и есть
      // содержимое карточки; блоки добавляются свёрнутыми (как раньше)
      if (isTool(el) || isPricetagList(el)) setExpandedId(el.id);
      setJustAddedId(el.id);
    },
    [items.length, makeNewDivider, makeNewText, makeNewPtlist, makeNewRuler, openImagePicker]
  );

  /* ---------------------- Drag & drop инструментов --------------------- */

  const handleDragOver = useCallback(
    (e: React.DragEvent, page: number) => {
      if (!e.dataTransfer.types.includes(TOOL_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const rect = e.currentTarget.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      if (page < 0) {
        setDropTarget({ page, y: 0 });
        return;
      }
      const pageH = layout.pages[page]?.height ?? TAPE_PAGE_MAX_PX;
      const clamped = Math.max(PAGE_PAD_TOP, Math.min(offsetY, pageH - PAGE_PAD_BOTTOM));
      setDropTarget({ page, y: indicatorYAt(layout, page, clamped) });
    },
    [layout]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, page: number) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(TOOL_MIME);
      setDropTarget(null);
      if (!(TOOL_TYPES as readonly string[]).includes(raw)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      const index =
        page < 0 ? 0 : insertIndexAt(layout, page, Math.max(0, offsetY));
      addTool(raw as ToolType, index);
    },
    [addTool, layout]
  );

  /* ------------------------ Правки элементов --------------------------- */

  const updateField = useCallback(
    (
      id: string,
      patch: Partial<Omit<TextFieldItem, "frame">> &
        Partial<DividerItem> &
        Partial<ImageItem> &
        Partial<Omit<PricetagItem, "frame">> &
        Partial<RulerItem> &
        Partial<ToolItem> &
        Partial<Omit<PricetagListItem, "frame">> & {
          /** Рамка текста (стиль) или рамка списка ценников (вкл/выкл) */
          frame?: TextFrameStyle | boolean;
        }
    ) => {
      setItems((prev) =>
        prev.map((f) => {
          if (f.id !== id) return f;
          let next = { ...f, ...patch } as LabelItem;
          if (isDivider(next)) {
            // Встроенный разделитель: высота следует за стилем/толщиной
            if (!next.svg) next = { ...next, height: builtinDividerHeight(next.style, next.thickness) };
            // Ширина меняется — держим блок по центру ленты
            if (patch.width !== undefined) {
              next = { ...next, x: Math.max(0, Math.round((PRINTER_HEAD_WIDTH - next.width) / 2)) };
            }
          }
          return next;
        })
      );
    },
    []
  );

  /** Патч данных генератора (форма карточки живёт в самом элементе) */
  const updateToolData = useCallback((id: string, patch: object) => {
    setItems((prev) =>
      prev.map((f) =>
        f.id === id && isTool(f) ? { ...f, data: { ...f.data, ...patch } as TapeToolData } : f
      )
    );
  }, []);

  /* ----------------- Список ценников: теги и CSV ------------------ */

  const updatePtTag = useCallback((id: string, tagIndex: number, patch: Partial<PricetagListTag>) => {
    setItems((prev) =>
      prev.map((f) => {
        if (f.id !== id || !isPricetagList(f)) return f;
        return {
          ...f,
          tags: f.tags.map((tg, i) => (i === tagIndex ? { ...tg, ...patch } : tg)),
        };
      })
    );
  }, []);

  const addPtTag = useCallback(
    (id: string) => {
      const target = items.find((f) => f.id === id);
      if (!target || !isPricetagList(target) || target.tags.length >= PTLIST_TAGS_MAX) return;
      const newIndex = target.tags.length;
      addCounterRef.current += 1;
      const n = addCounterRef.current;
      const tag = makePricetagListTag(t("tape.ptNewNameN", { n }), "100");
      setItems((prev) =>
        prev.map((f) => {
          if (f.id !== id || !isPricetagList(f) || f.tags.length >= PTLIST_TAGS_MAX) return f;
          return { ...f, tags: [...f.tags, tag] };
        })
      );
      setPtOpenTag({ id, index: newIndex });
    },
    [items, t]
  );

  const removePtTag = useCallback((id: string, tagIndex: number) => {
    setItems((prev) =>
      prev.map((f) =>
        f.id === id && isPricetagList(f)
          ? { ...f, tags: f.tags.filter((_tg, i) => i !== tagIndex) }
          : f
      )
    );
    setPtOpenTag((open) => {
      if (!open || open.id !== id) return open;
      if (open.index === tagIndex) return null;
      if (open.index > tagIndex) return { ...open, index: open.index - 1 };
      return open;
    });
  }, []);

  const movePtTag = useCallback((id: string, tagIndex: number, dir: -1 | 1) => {
    setItems((prev) =>
      prev.map((f) => {
        if (f.id !== id || !isPricetagList(f)) return f;
        const to = tagIndex + dir;
        if (to < 0 || to >= f.tags.length) return f;
        const tags = [...f.tags];
        const [moved] = tags.splice(tagIndex, 1);
        tags.splice(to, 0, moved);
        return { ...f, tags };
      })
    );
    setPtOpenTag((open) =>
      open && open.id === id && open.index === tagIndex ? { ...open, index: tagIndex + dir } : open
    );
  }, []);

  const openPtCsvPicker = useCallback((id: string) => {
    csvTargetIdRef.current = id;
    ptCsvInputRef.current?.click();
  }, []);

  /** Импорт CSV в список ценников — товары ДОБАВЛЯЮТСЯ к списку (как на вкладке) */
  const handlePtCsvFile = useCallback(
    (file: File | undefined) => {
      const id = csvTargetIdRef.current;
      csvTargetIdRef.current = null;
      if (!id || !file) return;
      void file.text().then((text) => {
        const parsed = importPricetagsFromCsv(text);
        if (!parsed.length) {
          toast({ title: t("pt.csvEmpty"), description: t("pt.csvEmptyDesc"), variant: "destructive" });
          return;
        }
        setItems((prev) =>
          prev.map((f) => {
            if (f.id !== id || !isPricetagList(f)) return f;
            const room = Math.max(0, PTLIST_TAGS_MAX - f.tags.length);
            const incoming = parsed.slice(0, room).map((tg) => ({
              name: tg.name,
              price: tg.price,
              oldPrice: tg.oldPrice,
              sku: tg.sku,
              qr: tg.qr,
              barcode: tg.barcode,
              extraLines: [...tg.extraLines],
            }));
            return incoming.length ? { ...f, tags: [...f.tags, ...incoming] } : f;
          })
        );
        toast({
          title: t("ptl.csvImportOk", { n: parsed.length }),
          description: t("ptl.csvImportOkDesc"),
        });
      });
    },
    [t, toast]
  );

  /** Экспорт списка ценников в CSV — тот же формат, что на вкладке «Ценник» */
  const exportPtCsv = useCallback(
    (f: PricetagListItem) => {
      if (!f.tags.length) return;
      const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
      const header = [
        t("pt.csvHead.name"),
        t("pt.csvHead.price"),
        t("pt.csvHead.old"),
        t("pt.csvHead.qr"),
        t("pt.csvHead.barcode"),
        t("pt.csvHead.sku"),
        t("pt.csvHead.lines"),
      ];
      const rows = f.tags.map((tg) =>
        [
          tg.name,
          tg.price,
          tg.oldPrice,
          tg.qr,
          tg.barcode,
          tg.sku,
          tg.extraLines.filter((l) => l.trim()).join("|"),
        ]
          .map(esc)
          .join(";")
      );
      const blob = new Blob(["\uFEFF" + [header.map(esc).join(";"), ...rows].join("\n")], {
        type: "text/csv;charset=utf-8",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pricetags-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: t("pt.csvSaved"), description: t("pt.csvSavedDesc", { n: f.tags.length }) });
    },
    [t, toast]
  );

  /** Последняя сфокусированная строка ценника списка — куда втыкаются чипы подстановок */
  const ptLineFocusRef = useRef<{ id: string; tagIndex: number; lineIndex: number } | null>(null);

  /** Вставить подстановку ({name} и т.п.) в строку ценника — как на вкладке */
  const insertPtPlaceholder = useCallback((id: string, tagIndex: number, ph: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id || !isPricetagList(it)) return it;
        const tag = it.tags[tagIndex];
        if (!tag) return it;
        const lines = [...tag.extraLines];
        if (!lines.length) lines.push("");
        const focus = ptLineFocusRef.current;
        let idx =
          focus && focus.id === id && focus.tagIndex === tagIndex
            ? focus.lineIndex
            : lines.length - 1;
        if (idx < 0 || idx >= lines.length) idx = lines.length - 1;
        lines[idx] = (lines[idx] ?? "") + ph;
        return {
          ...it,
          tags: it.tags.map((tg, i) => (i === tagIndex ? { ...tg, extraLines: lines } : tg)),
        };
      })
    );
  }, []);

  const setAlign = useCallback(
    (field: TextFieldItem, align: TextAlignment) => {
      const m = measureField(field);
      let x = 16;
      if (align === "center") x = Math.round((PRINTER_HEAD_WIDTH - m.width) / 2);
      if (align === "right") x = PRINTER_HEAD_WIDTH - m.width - 16;
      updateField(field.id, { x: Math.max(0, x) });
    },
    [updateField]
  );

  const duplicateItem = useCallback(
    (id: string) => {
      const src = items.find((f) => f.id === id);
      if (!src) return;
      // Глубокая копия: массивы внутри (extraLines, пункты чек-листа,
      // позиции чека, теги списка ценников) не должны делиться с оригиналом
      const copy = JSON.parse(JSON.stringify(src)) as LabelItem;
      copy.id = createId();
      setItems((prev) => {
        const i = prev.findIndex((f) => f.id === id);
        if (i < 0) return prev;
        const next = [...prev];
        next.splice(i + 1, 0, copy);
        return next;
      });
      setSelectedId(copy.id);
      // Дубликат добавляется свёрнутым — «Ещё» раскрывается только вручную
      toast({ title: t("tt.duplicated"), description: t("tt.duplicatedDesc") });
    },
    [items, toast, t]
  );

  const removeField = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((f) => f.id !== id);
        if (selectedId === id) setSelectedId(next[0]?.id ?? null);
        return next;
      });
      if (expandedId === id) setExpandedId(null);
      if (ptOpenTag?.id === id) setPtOpenTag(null);
    },
    [selectedId, expandedId, ptOpenTag]
  );

  /* ------------- Перетаскивание карточек списка (Pointer Events) ------------- */

  const beginFieldDrag = useCallback((e: React.PointerEvent, id: string) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    fieldDragRef.current = { id };
    setDragFieldId(id);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* нет поддержки — не критично */
    }
  }, []);

  const moveFieldDrag = useCallback((e: React.PointerEvent) => {
    const st = fieldDragRef.current;
    if (!st) return;
    let targetId = st.id;
    for (const [id, el] of fieldRowsRef.current) {
      const r = el.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        targetId = id;
        break;
      }
    }
    if (targetId === st.id) return;
    setItems((prev) => {
      const from = prev.findIndex((f) => f.id === st.id);
      const to = prev.findIndex((f) => f.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const endFieldDrag = useCallback((e: React.PointerEvent) => {
    if (!fieldDragRef.current) return;
    fieldDragRef.current = null;
    setDragFieldId(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* нет поддержки — не критично */
    }
  }, []);

  /* ------------------------ Свой SVG-разделитель ----------------------- */

  const openSvgPicker = useCallback((id: string) => {
    svgTargetRef.current = id;
    svgInputRef.current?.click();
  }, []);

  const handleSvgFile = useCallback(
    (file: File | undefined) => {
      const id = svgTargetRef.current;
      svgTargetRef.current = null;
      if (!id || !file) return;
      if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
        toast({ title: t("tt.dividerBadFile"), variant: "destructive" });
        return;
      }
      if (file.size > SVG_MAX_BYTES) {
        toast({
          title: t("tt.dividerTooBig"),
          description: t("tt.dividerTooBigDesc"),
          variant: "destructive",
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const probe = new Image();
        probe.onload = () => {
          const ratio =
            probe.naturalWidth > 0 ? probe.naturalHeight / probe.naturalWidth : 0.05;
          setItems((prev) =>
            prev.map((f) => {
              if (f.id !== id || !isDivider(f)) return f;
              const height = Math.max(2, Math.min(160, Math.round(f.width * ratio)));
              return { ...f, svg: src, ratio, height };
            })
          );
          setSelectedId(id);
          bump();
          toast({ title: t("tt.dividerSvgOk"), description: t("tt.dividerSvgOkDesc") });
        };
        probe.onerror = () => {
          toast({ title: t("tt.dividerBadFile"), variant: "destructive" });
        };
        probe.src = src;
      };
      reader.onerror = () => {
        toast({ title: t("tt.dividerBadFile"), variant: "destructive" });
      };
      reader.readAsDataURL(file);
    },
    [toast, t, bump]
  );

  /* --------------------------- Картинка ленты -------------------------- */

  const handleImageFile = useCallback(
    (file: File | undefined) => {
      const index = pendingImageIndexRef.current;
      pendingImageIndexRef.current = null;
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast({ title: t("tape.imgBadFile"), variant: "destructive" });
        return;
      }
      if (file.size > IMG_MAX_BYTES) {
        toast({
          title: t("tape.imgTooBig"),
          description: t("tape.imgTooBigDesc"),
          variant: "destructive",
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const probe = new Image();
        probe.onload = () => {
          const { width, height } = fitImageSize(
            probe.naturalWidth || 1,
            probe.naturalHeight || 1
          );
          const el: ImageItem = {
            id: createId(),
            kind: "image",
            src,
            x: Math.round((PRINTER_HEAD_WIDTH - width) / 2),
            y: 0,
            width,
            height,
            dither: "steinberg",
            brightness: 0,
            contrast: 0,
          };
          setItems((prev) => {
            const at = Math.max(0, Math.min(index ?? prev.length, prev.length));
            const next = [...prev];
            next.splice(at, 0, el);
            return next;
          });
          setSelectedId(el.id);
          bump();
        };
        probe.onerror = () => {
          toast({ title: t("tape.imgBadFile"), variant: "destructive" });
        };
        probe.src = src;
      };
      reader.onerror = () => {
        toast({ title: t("tape.imgBadFile"), variant: "destructive" });
      };
      reader.readAsDataURL(file);
    },
    [toast, t, bump]
  );

  /* Автотон картинки ленты: тон по гистограмме исходника → в слайдеры «Ещё»
     (та же логика, что у вкладки «Изображение»: перцентили 1%/99%,
     контраст растягивает диапазон, гамма ставит середину на 128) */
  const handleAutoTone = useCallback(
    (f: ImageItem) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 1;
        c.height = img.naturalHeight || 1;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const tone = autoTone(toGray(ctx.getImageData(0, 0, c.width, c.height).data));
        updateField(f.id, { brightness: tone.brightness, contrast: tone.contrast });
        toast({
          title: t("it.autoDone"),
          description:
            tone.brightness === 0 && tone.contrast === 0
              ? t("it.autoAlready")
              : t("it.autoDesc", {
                  b: `${tone.brightness > 0 ? "+" : ""}${tone.brightness}`,
                  c: tone.contrast,
                }),
        });
      };
      img.onerror = () => {
        toast({ title: t("tape.imgBadFile"), variant: "destructive" });
      };
      img.src = f.src;
    },
    [updateField, toast, t]
  );

  /* ------------------------------- Печать ------------------------------ */

  const handlePrint = useCallback(async () => {
    // - Не-BLE транспорта: POS-USB (ESC/POS, usb-printer-context) и HPRT
    //   (v1.0.55, BT-этикетки через hprt-printer-context) — ветка не зависит
    //   от Web Bluetooth и его отсутствия -
    if (transport !== "ble") {
      if (!items.length) {
        toast({
          title: t("tt.nothingToPrint"),
          description: t("tt.nothingToPrintDesc"),
          variant: "destructive",
        });
        return;
      }
      setPrinting(true);
      try {
        // Дождаться загрузки SVG-разделителей и картинок (иначе уйдут заглушки)
        await ensureDividerImages(items);
        await ensureTapeImages(items);
        const pages = layoutTape(items, {
          ...(fixedPageHeight ? { fixedPageHeight } : {}),
          i18n: tapeI18n,
        }).pages;
        for (const page of pages) {
          const canvas = document.createElement("canvas");
          renderTapePage(canvas, page, tapeI18n);
          const combined = renderCopies(canvas, copies);
          await (transport === "usb" ? printUsb : printHprt)(combined);
          notePrintedMm(combined.height / PX_PER_MM);
        }
        setBanner(t("tape.sentToPrint", { n: pages.length }));
        setTimeout(() => setBanner(null), 4000);
      } catch (e) {
        toast({
          title: t("common.printError"),
          description: (e as Error)?.message ?? t("tt.printFailed"),
          variant: "destructive",
        });
      } finally {
        setPrinting(false);
      }
      return;
    }
    if (status === "unsupported") {
      window.dispatchEvent(new CustomEvent("mxw01:ble-warning"));
      return;
    }
    if (!items.length) {
      toast({
        title: t("tt.nothingToPrint"),
        description: t("tt.nothingToPrintDesc"),
        variant: "destructive",
      });
      return;
    }
    setPrinting(true);
    try {
      if (status !== "connected") {
        toast({ title: t("common.connecting") });
        await connect();
      }
      // Дождаться загрузки SVG-разделителей и картинок (иначе уйдут заглушки)
      await ensureDividerImages(items);
      await ensureTapeImages(items);
      const pages = layoutTape(items, {
        ...(fixedPageHeight ? { fixedPageHeight } : {}),
        i18n: tapeI18n,
      }).pages;
      for (const page of pages) {
        const canvas = document.createElement("canvas");
        renderTapePage(canvas, page, tapeI18n);
        // Копии страницы собираются в одну ленту и печатаются одним заданием
        const combined = renderCopies(canvas, copies);
        await printCanvas(combined);
        notePrintedMm(combined.height / PX_PER_MM);
      }
      setBanner(t("tape.sentToPrint", { n: pages.length }));
      setTimeout(() => setBanner(null), 4000);
    } catch (e) {
      toast({
        title: t("common.printError"),
        description: (e as Error)?.message ?? t("tt.printFailed"),
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }, [connect, items, printCanvas, copies, status, toast, t, fixedPageHeight, tapeI18n, transport, printUsb, printHprt]);

  /** Сохранить страницу картинкой (v1.0.27): PNG в полном качестве 4×.
   *  Имя файла mxw01-page-N-ГГГГММДД-ЧЧММСС.png; после скачивания — тост
   *  с именем файла, при ошибке — destructive-тост. */
  const handleSavePage = useCallback(
    async (page: TapePage) => {
      try {
        // Рендер всегда в 4× (SUPER_SAMPLE по умолчанию) — качество превью
        // на сохранение не влияет
        const canvas = document.createElement("canvas");
        renderTapePage(canvas, page, tapeI18n);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png")
        );
        if (!blob) throw new Error("png-encode-failed");
        const p2 = (n: number) => String(n).padStart(2, "0");
        const d = new Date();
        const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
        const name = `mxw01-page-${page.index + 1}-${stamp}.png`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast({ title: t("tape.saveImgDone"), description: name });
      } catch {
        toast({ title: t("tape.saveImgFail"), variant: "destructive" });
      }
    },
    [toast, t, tapeI18n]
  );

  const selected = useMemo(
    () => items.find((f) => f.id === selectedId) ?? null,
    [items, selectedId]
  );

  const totalMm = useMemo(
    () => Math.round(layout.pages.reduce((s, p) => s + p.height, 0) / PX_PER_MM),
    [layout.pages]
  );

  const gripCls = (active: boolean) =>
    cn(
      "flex w-5 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded text-slate-300 transition-colors hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300",
      active && "cursor-grabbing text-slate-700 dark:text-slate-200"
    );

  return (
    <Workspace>
      {/* ------------------------- Левая панель ------------------------- */}
      <LeftPanel>
        <div className="space-y-4 p-4">
          {/* Палитра: блоки */}
          <SectionHeader
            icon={<Layers className="h-4 w-4 shrink-0 text-slate-400" />}
            title={t("tape.palette")}
          />
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { tool: "text", Icon: Type, label: t("tape.toolText") },
                { tool: "divider", Icon: SeparatorHorizontal, label: t("tape.toolDivider") },
                { tool: "image", Icon: ImageIcon, label: t("tape.toolImage") },
                { tool: "pricetag", Icon: Tag, label: t("tape.toolPricetag") },
                { tool: "ruler", Icon: Ruler, label: t("tape.toolRuler") },
              ] as const
            ).map(({ tool, Icon, label }) => (
              <button
                key={tool}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TOOL_MIME, tool);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addTool(tool)}
                aria-label={label}
                title={label}
                className="flex h-16 cursor-grab flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                <Icon className="h-5 w-5 text-slate-400" />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>

          {/* Палитра: генераторы (бывшая вкладка «Инструменты») */}
          <SectionHeader title={t("tape.paletteTools")} />
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { tool: "qr", Icon: QrCode, label: t("tool.qr.title") },
                { tool: "wifi", Icon: Wifi, label: t("tool.wifi.title") },
                { tool: "checklist", Icon: ListChecks, label: t("tool.checklist.title") },
                { tool: "receipt", Icon: Receipt, label: t("tool.receipt.title") },
                { tool: "dates", Icon: CalendarClock, label: t("tool.dates.title") },
                { tool: "numbers", Icon: Hash, label: t("tool.numbers.title") },
                { tool: "calendar", Icon: CalendarDays, label: t("tool.calendar.title") },
                { tool: "habits", Icon: LayoutGrid, label: t("tool.habits.title") },
                { tool: "replace", Icon: Replace, label: t("tool.replace.title") },
              ] as const
            ).map(({ tool, Icon, label }) => (
              <button
                key={tool}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TOOL_MIME, tool);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addTool(tool)}
                aria-label={label}
                title={label}
                className="flex h-16 cursor-grab flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                <Icon className="h-5 w-5 text-slate-400" />
                <span className="w-full truncate px-1 text-center text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">
            {t("tape.paletteHint")}
          </p>

          {/* Список элементов */}
          <SectionHeader
            title={t("tape.section")}
            badge={items.length}
          />
          {items.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-muted-foreground dark:border-slate-700">
              {t("tape.empty")}
            </p>
          )}

          <div className="space-y-1.5">
            {items.map((f, idx) => {
              const expanded = expandedId === f.id;
              const isSelected = f.id === selectedId;
              const divider = isDivider(f);
              const image = isImage(f);
              const ruler = isRuler(f);
              const toolItem = isTool(f);
              const ptlist = isPricetagList(f);
              const elPage = layout.elementSegments[idx]?.[0]?.page;
              const sizeMeta = ruler
                ? t("tape.pillLen", { mm: f.lengthMm })
                : divider || image
                  ? `${f.width}×${f.height} px`
                  : toolItem
                    ? `${toolChunksHeightPx(
                        toolItemChunks(f, fixedPageHeight || TAPE_PAGE_MAX_PX, tapeI18n)
                      )} px`
                    : ptlist
                      ? `${(layout.elementSegments[idx] ?? [])
                          .reduce((s2, seg) => s2 + (seg.bottom - seg.top), 0)} px`
                      : `${measureField(f as TextFieldItem).width}×${measureField(f as TextFieldItem).height} px`;
              return (
                <div
                  key={f.id}
                  ref={(el) => {
                    if (el) fieldRowsRef.current.set(f.id, el);
                    else fieldRowsRef.current.delete(f.id);
                  }}
                  onClick={() => setSelectedId(f.id)}
                  className={cn(
                    "relative rounded-lg border bg-white p-1.5 transition-colors dark:bg-slate-900",
                    dragFieldId === f.id
                      ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800"
                      : isSelected
                        ? "border-slate-900 dark:border-slate-100"
                        : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                  )}
                >
                  {divider ? (
                    /* ------------------ Карточка разделителя ------------------ */
                    <div
                      className={cn(
                        "grid items-center gap-x-1 gap-y-1",
                        f.svg
                          ? "grid-cols-[auto_minmax(0,1fr)_auto]"
                          : "grid-cols-[auto_minmax(0,1fr)]"
                      )}
                    >
                      <span
                        onPointerDown={(e) => beginFieldDrag(e, f.id)}
                        onPointerMove={moveFieldDrag}
                        onPointerUp={endFieldDrag}
                        onPointerCancel={endFieldDrag}
                        title={t("tt.dragOrder")}
                        aria-label={t("tt.dragOrder")}
                        role="button"
                        className={cn(gripCls(dragFieldId === f.id), "row-span-2")}
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-1">
                        {/* Стиль разделителя — выпадающий список, как ширина/толщина */}
                        <select
                          value={f.style}
                          disabled={!!f.svg}
                          onChange={(e) =>
                            updateField(f.id, { style: e.target.value as DividerStyle })
                          }
                          aria-label={t("tt.dividerStyle")}
                          className={selectCls}
                        >
                          <option value="solid">{t("tt.dividerSolid")}</option>
                          <option value="dashed">{t("tt.dividerDashed")}</option>
                          <option value="dotted">{t("tt.dividerDotted")}</option>
                          <option value="double">{t("tt.dividerDouble")}</option>
                          <option value="zigzag">{t("tt.dividerZigzag")}</option>
                        </select>
                        <select
                          value={String(f.width)}
                          onChange={(e) => updateField(f.id, { width: Number(e.target.value) })}
                          aria-label={t("tt.dividerWidth")}
                          className={selectCls}
                        >
                          {DIVIDER_WIDTHS.map((w) => (
                            <option key={w} value={String(w)}>
                              {w === 352
                                ? t("tt.dividerWFull")
                                : w === 240
                                  ? t("tt.dividerWMid")
                                  : t("tt.dividerWShort")}
                            </option>
                          ))}
                        </select>
                        <select
                          value={String(f.thickness)}
                          disabled={!!f.svg}
                          onChange={(e) => updateField(f.id, { thickness: Number(e.target.value) })}
                          aria-label={t("tt.dividerThickness")}
                          className={selectCls}
                        >
                          {[1, 2, 3, 4, 5].map((v) => (
                            <option key={v} value={String(v)}>
                              {v} px
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Иконки карточки — в ряд под селектами */}
                      <div className="col-start-2 row-start-2 flex flex-wrap items-center gap-1">
                        <IconBtn
                          title={t("tape.overlayTitle")}
                          active={!!f.overlay}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateField(f.id, { overlay: !f.overlay });
                          }}
                          className="h-6 w-6 text-xs font-bold"
                        >
                          <Strikethrough className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          title={t("tt.dividerUpload")}
                          active={!!f.svg}
                          onClick={(e) => {
                            e.stopPropagation();
                            openSvgPicker(f.id);
                          }}
                          className="h-6 w-6"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </IconBtn>
                        {f.svg && (
                          <IconBtn
                            title={t("tt.dividerReset")}
                            onClick={(e) => {
                              e.stopPropagation();
                              updateField(f.id, {
                                svg: undefined,
                                ratio: undefined,
                                height: builtinDividerHeight(f.style, f.thickness),
                              });
                            }}
                            className="h-6 w-6"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                      </div>
                      {/* Превью своего SVG — правая колонка карточки, как у картинки */}
                      {f.svg && (
                        <div className="col-start-3 row-start-1 row-span-2 flex h-16 w-24 min-w-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white px-1 dark:border-slate-700 dark:bg-slate-800">
                          <span className="flex h-14 w-full items-center justify-center">
                            <DividerVisual d={f} />
                          </span>
                        </div>
                      )}
                    </div>
                  ) : image ? (
                    /* ------------------- Карточка картинки -------------------- */
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 gap-y-1">
                      <span
                        onPointerDown={(e) => beginFieldDrag(e, f.id)}
                        onPointerMove={moveFieldDrag}
                        onPointerUp={endFieldDrag}
                        onPointerCancel={endFieldDrag}
                        title={t("tt.dragOrder")}
                        aria-label={t("tt.dragOrder")}
                        role="button"
                        className={cn(gripCls(dragFieldId === f.id), "row-span-2")}
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-1">
                        <select
                          value={f.dither}
                          onChange={(e) =>
                            updateField(f.id, { dither: e.target.value as ImageItem["dither"] })
                          }
                          aria-label={t("tape.imgDither")}
                          className={selectCls}
                        >
                          <option value="steinberg">Floyd–Steinberg</option>
                          <option value="bayer">Bayer 8×8</option>
                          <option value="atkinson">Atkinson</option>
                          <option value="none">{t("tape.imgDitherNone")}</option>
                        </select>
                      </div>
                      {/* Иконки карточки — в ряд под селектом */}
                      <div className="col-start-2 row-start-2 flex flex-wrap items-center gap-1">
                        <IconBtn
                          title={t("tape.imgReplace")}
                          onClick={(e) => {
                            e.stopPropagation();
                            pendingImageIndexRef.current = idx;
                            imgInputRef.current?.click();
                          }}
                          className="h-6 w-6"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          title={t("it.autoTitle")}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAutoTone(f);
                          }}
                          className="h-6 w-6"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          title={t("tape.imgResetTone")}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateField(f.id, { brightness: 0, contrast: 0, dither: "steinberg" });
                          }}
                          className="h-6 w-6"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </IconBtn>
                      </div>
                      {/* Превью картинки — правая колонка карточки */}
                      <div className="col-start-3 row-start-1 row-span-2 flex h-16 w-24 min-w-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white px-1 dark:border-slate-700 dark:bg-slate-800">
                        <img
                          src={f.src}
                          alt={t("tape.imgAria")}
                          draggable={false}
                          className="max-h-14 max-w-full object-contain"
                        />
                      </div>
                    </div>
                  ) : toolItem ? (
                    /* ------------------ Карточка генератора ------------------- */
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-1">
                      <span
                        onPointerDown={(e) => beginFieldDrag(e, f.id)}
                        onPointerMove={moveFieldDrag}
                        onPointerUp={endFieldDrag}
                        onPointerCancel={endFieldDrag}
                        title={t("tt.dragOrder")}
                        aria-label={t("tt.dragOrder")}
                        role="button"
                        className={gripCls(dragFieldId === f.id)}
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        {(() => {
                          const meta = toolCardMeta(f.tool, f.data, t);
                          const Icon = meta.Icon;
                          return (
                            <div className="flex items-center gap-1.5 pb-1.5">
                              <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                              <span className="min-w-0 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                                {meta.title}
                              </span>
                              {meta.summary && (
                                <span className="ml-auto min-w-0 max-w-[45%] truncate text-[11px] text-slate-400">
                                  {meta.summary}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <ToolFieldsById
                          tool={f.tool}
                          data={f.data}
                          onChange={(patch) => updateToolData(f.id, patch)}
                          t={t}
                          lang={lang}
                        />
                      </div>
                    </div>
                  ) : ptlist ? (
                    /* ---------------- Карточка списка ценников ---------------- */
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-1">
                      <span
                        onPointerDown={(e) => beginFieldDrag(e, f.id)}
                        onPointerMove={moveFieldDrag}
                        onPointerUp={endFieldDrag}
                        onPointerCancel={endFieldDrag}
                        title={t("tt.dragOrder")}
                        aria-label={t("tt.dragOrder")}
                        role="button"
                        className={gripCls(dragFieldId === f.id)}
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 space-y-1.5">
                        {/* Шапка: заголовок, количество и действия списка */}
                        <div className="flex flex-wrap items-center gap-1">
                          <Tag className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {t("tape.toolPricetag")}
                          </span>
                          <span className="text-[11px] tabular-nums text-slate-400">{f.tags.length}</span>
                          <span className="ml-auto flex items-center gap-1">
                            <IconBtn
                              title={t("tape.ptFrame")}
                              active={!!f.frame}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField(f.id, { frame: !f.frame });
                              }}
                              className="h-6 w-6"
                            >
                              <RectangleHorizontal className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn
                              title={t("ptl.importCsv")}
                              onClick={(e) => {
                                e.stopPropagation();
                                openPtCsvPicker(f.id);
                              }}
                              className="h-6 w-6"
                            >
                              <FileUp className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn
                              title={t("ptl.exportCsv")}
                              disabled={!f.tags.length}
                              onClick={(e) => {
                                e.stopPropagation();
                                exportPtCsv(f);
                              }}
                              className="h-6 w-6"
                            >
                              <FileDown className="h-3.5 w-3.5" />
                            </IconBtn>
                          </span>
                        </div>

                        {/* Ценники — раскрывающийся список: поля внутри раскрытого */}
                        {f.tags.length === 0 && (
                          <p className="rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-center text-xs text-slate-400 dark:border-slate-700">
                            {t("ptl.empty")}
                          </p>
                        )}
                        {f.tags.map((tg, ti) => {
                          const tagOpen = ptOpenTag?.id === f.id && ptOpenTag.index === ti;
                          const tagLines = tg.extraLines;
                          return (
                            <div
                              key={ti}
                              className={cn(
                                "rounded-md border",
                                tagOpen ? "border-slate-200 dark:border-slate-700" : "border-transparent"
                              )}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPtOpenTag(tagOpen ? null : { id: f.id, index: ti });
                                }}
                                aria-expanded={tagOpen}
                                className="flex w-full items-center gap-1 px-1 py-1 text-left"
                              >
                                <ChevronDown
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
                                    tagOpen && "rotate-180"
                                  )}
                                />
                                <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                                  {ti + 1}. {tg.name.trim() || t("ptl.untitled")}
                                  {tg.price.trim() ? ` — ${tg.price.trim()}` : ""}
                                </span>
                              </button>
                              {tagOpen && (
                                <div className="space-y-2 px-1 pb-1.5" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      value={tg.name}
                                      onChange={(e) => updatePtTag(f.id, ti, { name: e.target.value })}
                                      placeholder={t("tape.ptName")}
                                      aria-label={t("tape.ptNameAria")}
                                      className={cn(inputCls, "min-w-0 flex-1")}
                                    />
                                    <input
                                      type="text"
                                      value={tg.price}
                                      onChange={(e) => updatePtTag(f.id, ti, { price: e.target.value })}
                                      placeholder={t("tape.ptPrice")}
                                      aria-label={t("tape.ptPriceAria")}
                                      className={cn(inputCls, "w-20 shrink-0 text-right tabular-nums")}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="w-24 shrink-0 text-xs text-slate-400">
                                      {t("pt.oldPriceAria")}
                                    </span>
                                    <input
                                      type="text"
                                      value={tg.oldPrice}
                                      onChange={(e) => updatePtTag(f.id, ti, { oldPrice: e.target.value })}
                                      placeholder={t("pt.oldPricePlaceholder")}
                                      aria-label={t("pt.oldPriceAria")}
                                      className={cn(inputCls, "min-w-0 flex-1")}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="w-24 shrink-0 text-xs text-slate-400">{t("pt.skuAria")}</span>
                                    <input
                                      type="text"
                                      value={tg.sku}
                                      onChange={(e) => updatePtTag(f.id, ti, { sku: e.target.value })}
                                      placeholder={t("pt.skuPlaceholder")}
                                      aria-label={t("pt.skuAria")}
                                      className={cn(inputCls, "min-w-0 flex-1")}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="w-24 shrink-0 text-xs text-slate-400">{t("pt.qrAria")}</span>
                                    <input
                                      type="text"
                                      value={tg.qr}
                                      onChange={(e) => updatePtTag(f.id, ti, { qr: e.target.value })}
                                      placeholder={t("pt.qrPlaceholder")}
                                      aria-label={t("pt.qrAria")}
                                      className={cn(inputCls, "min-w-0 flex-1")}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="w-24 shrink-0 text-xs text-slate-400">
                                      {t("pt.barcodeAria")}
                                    </span>
                                    <input
                                      type="text"
                                      value={tg.barcode}
                                      onChange={(e) => updatePtTag(f.id, ti, { barcode: e.target.value })}
                                      placeholder={t("pt.barcodePlaceholder")}
                                      aria-label={t("pt.barcodeAria")}
                                      className={cn(inputCls, "min-w-0 flex-1")}
                                    />
                                  </div>

                                  {/* Строки ценника — у каждого тега свои, с подстановками */}
                                  <div className="space-y-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                        {t("pt.linesTitle")}
                                      </span>
                                      <div className="flex items-center gap-1">
                                        <IconBtn
                                          title={t("pt.deleteLastLine")}
                                          danger
                                          disabled={!tagLines.length}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            updatePtTag(f.id, ti, { extraLines: tagLines.slice(0, -1) });
                                          }}
                                          className="h-6 w-6"
                                        >
                                          <Minus className="h-3.5 w-3.5" />
                                        </IconBtn>
                                        <IconBtn
                                          title={t("common.add")}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            updatePtTag(f.id, ti, { extraLines: [...tagLines, ""] });
                                          }}
                                          className="h-6 w-6"
                                        >
                                          <Plus className="h-3.5 w-3.5" />
                                        </IconBtn>
                                      </div>
                                    </div>
                                    {tagLines.map((line, li) => (
                                      <div key={li} className="flex items-center gap-1">
                                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                          {li + 1}
                                        </span>
                                        <input
                                          type="text"
                                          value={line}
                                          onFocus={() => {
                                            ptLineFocusRef.current = { id: f.id, tagIndex: ti, lineIndex: li };
                                          }}
                                          onChange={(e) => {
                                            const next = [...tagLines];
                                            next[li] = e.target.value;
                                            updatePtTag(f.id, ti, { extraLines: next });
                                          }}
                                          placeholder={t("pt.linePlaceholder", { n: li + 1 })}
                                          aria-label={t("pt.lineAria", { n: li + 1 })}
                                          className={cn(inputCls, "min-w-0 flex-1")}
                                        />
                                        <IconBtn
                                          title={t("pt.deleteLine")}
                                          danger
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            updatePtTag(f.id, ti, {
                                              extraLines: tagLines.filter((_l, j) => j !== li),
                                            });
                                          }}
                                          className="h-6 w-6"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </IconBtn>
                                      </div>
                                    ))}
                                    {/* Подстановки — те же чипы, что на вкладке «Ценник» */}
                                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                      <span className="text-[11px] text-slate-400">{t("pt.insert")}</span>
                                      {PT_PLACEHOLDERS.map((c) => (
                                        <button
                                          key={c.ph}
                                          type="button"
                                          title={t("pt.chipTitle", { label: t(c.key) })}
                                          onClick={() => insertPtPlaceholder(f.id, ti, c.ph)}
                                          className="h-5 rounded border border-slate-200 bg-white px-1 font-mono text-[10px] text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-100 dark:hover:text-slate-100"
                                        >
                                          {c.ph}
                                        </button>
                                      ))}
                                    </div>
                                    <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                                      {t("pt.linesHint")}
                                    </p>
                                  </div>

                                  {/* Переставить / удалить ценник списка */}
                                  <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-0.5">
                                      <IconBtn
                                        title={t("ptl.moveUp")}
                                        disabled={ti === 0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          movePtTag(f.id, ti, -1);
                                        }}
                                        className="h-6 w-6"
                                      >
                                        <ArrowUp className="h-3.5 w-3.5" />
                                      </IconBtn>
                                      <IconBtn
                                        title={t("ptl.moveDown")}
                                        disabled={ti === f.tags.length - 1}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          movePtTag(f.id, ti, 1);
                                        }}
                                        className="h-6 w-6"
                                      >
                                        <ArrowDown className="h-3.5 w-3.5" />
                                      </IconBtn>
                                    </span>
                                    <IconBtn
                                      title={t("ptl.deleteTag")}
                                      danger
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removePtTag(f.id, ti);
                                      }}
                                      className="h-6 w-6"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </IconBtn>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addPtTag(f.id);
                          }}
                          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-200 dark:hover:text-slate-100"
                        >
                          <Plus className="h-4 w-4" />
                          {t("ptl.addTag")}
                        </button>
                      </div>
                    </div>
                  ) : ruler ? (
                    /* -------------------- Карточка линейки --------------------- */
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1">
                      <span
                        onPointerDown={(e) => beginFieldDrag(e, f.id)}
                        onPointerMove={moveFieldDrag}
                        onPointerUp={endFieldDrag}
                        onPointerCancel={endFieldDrag}
                        title={t("tt.dragOrder")}
                        aria-label={t("tt.dragOrder")}
                        role="button"
                        className={gripCls(dragFieldId === f.id)}
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <div className="col-start-2 row-start-1 flex min-w-0 items-center gap-1">
                        <span className="w-16 shrink-0 text-xs text-slate-400">
                          {t("tape.rulerLen")}
                        </span>
                        <input
                          key={f.lengthMm}
                          type="number"
                          inputMode="numeric"
                          min={RULER_MM_MIN}
                          max={RULER_MM_MAX}
                          defaultValue={String(f.lengthMm)}
                          onBlur={(e) => {
                            const v = clampNum(
                              e.target.value,
                              RULER_MM_MIN,
                              RULER_MM_MAX,
                              50
                            );
                            updateField(f.id, { lengthMm: v });
                            e.target.value = String(v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          aria-label={t("tape.rulerLenAria")}
                          className={cn(inputCls, "w-20 shrink-0 text-right tabular-nums")}
                        />
                        <span className="shrink-0 text-xs text-slate-400">
                          {t("tape.rulerUnit")}
                        </span>
                      </div>
                    </div>
                  ) : (
                    /* ------------------- Карточка текста ---------------------- */
                    (() => {
                      // Сюда доходят только текстовые элементы: ценники мигрируют
                      // в списки при загрузке (normalizeItem)
                      const tf = f as TextFieldItem;
                      return (
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1">
                      <span
                        onPointerDown={(e) => beginFieldDrag(e, f.id)}
                        onPointerMove={moveFieldDrag}
                        onPointerUp={endFieldDrag}
                        onPointerCancel={endFieldDrag}
                        title={t("tt.dragOrder")}
                        aria-label={t("tt.dragOrder")}
                        role="button"
                        className={gripCls(dragFieldId === f.id)}
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <div className="relative min-w-0">
                        <EmojiTextarea
                          t={t}
                          growKey={`${tf.text}|${tf.fontSize}|${tf.bold}|${tf.fontFamily}`}
                          value={tf.text}
                          onValueChange={(v) => updateField(f.id, { text: v })}
                          placeholder={t("tt.textPlaceholder")}
                          aria-label={t("tt.textAria")}
                          autoFocus={justAddedId === f.id}
                          className="min-h-14 max-h-48 min-w-0 resize-none overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-2 pr-8 text-sm text-slate-900 outline-none placeholder:text-slate-300 hover:border-slate-300 focus:border-slate-900 focus:bg-white sm:min-h-18 dark:text-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-600 dark:hover:border-slate-600 dark:focus:border-slate-100 dark:focus:bg-slate-900"
                        />
                      </div>
                    </div>
                      );
                    })()
                  )}

                  {/* Ещё — широкая строка по центру (у разделителя
                      и линейки скрытой секции нет) */}
                  {!divider && !ruler && (
                    <button
                      type="button"
                      title={t("tt.more")}
                      aria-label={t("tt.more")}
                      onClick={() => setExpandedId(expanded ? null : f.id)}
                      className="mt-0.5 flex h-5 w-full items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                      />
                    </button>
                  )}

                  {expanded && (
                    <div className="mt-1.5 space-y-2 border-t border-slate-100 px-1 pt-2 dark:border-slate-800">
                      {image ? (
                        <>
                          <label className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="w-16 shrink-0">{t("tape.imgBrightness")}</span>
                            <input
                              type="range"
                              min={-100}
                              max={100}
                              value={f.brightness}
                              onChange={(e) =>
                                updateField(f.id, { brightness: Number(e.target.value) })
                              }
                              aria-label={t("tape.imgBrightness")}
                              className="h-1 min-w-0 flex-1 accent-slate-900"
                            />
                            <span className="w-8 text-right tabular-nums">{f.brightness}</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="w-16 shrink-0">{t("tape.imgContrast")}</span>
                            <input
                              type="range"
                              min={-100}
                              max={100}
                              value={f.contrast}
                              onChange={(e) =>
                                updateField(f.id, { contrast: Number(e.target.value) })
                              }
                              aria-label={t("tape.imgContrast")}
                              className="h-1 min-w-0 flex-1 accent-slate-900"
                            />
                            <span className="w-8 text-right tabular-nums">{f.contrast}</span>
                          </label>
                        </>
                      ) : ptlist ? (
                        <>
                          {/* Общая типографика списка — как на вкладке «Ценник»:
                              кегли четырёх элементов, шрифт, жирность,
                              выравнивания; поля товара и строки — в каждом теге */}
                          <div className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-xs text-slate-400">
                              {t("pt.size.name")}
                            </span>
                            <SizeSelect
                              t={t}
                              value={f.nameSize ?? pricetagNameSize(f.fontSize)}
                              min={12}
                              max={96}
                              onChange={(v) => updateField(f.id, { nameSize: v })}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-xs text-slate-400">
                              {t("pt.size.price")}
                            </span>
                            <SizeSelect
                              t={t}
                              value={f.fontSize}
                              min={16}
                              max={96}
                              onChange={(v) => updateField(f.id, { fontSize: v })}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-xs text-slate-400">
                              {t("pt.size.extra")}
                            </span>
                            <SizeSelect
                              t={t}
                              value={f.extraSize ?? 24}
                              min={8}
                              max={48}
                              onChange={(v) => updateField(f.id, { extraSize: v })}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-xs text-slate-400">
                              {t("pt.size.old")}
                            </span>
                            <SizeSelect
                              t={t}
                              value={f.oldPriceSize ?? pricetagOldSize(f.fontSize)}
                              min={10}
                              max={48}
                              onChange={(v) => updateField(f.id, { oldPriceSize: v })}
                            />
                          </div>

                          {/* Шрифт и жирность названия/цены */}
                          <div className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-xs text-slate-400">
                              {t("pt.font")}
                            </span>
                            <select
                              value={f.fontFamily ?? "sans-serif"}
                              onChange={(e) => updateField(f.id, { fontFamily: e.target.value })}
                              aria-label={t("pt.fontAria")}
                              className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              {FONT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <IconBtn
                              title={`${t("pt.weight")}: ${t("pt.size.name")}`}
                              active={f.nameBold ?? true}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField(f.id, { nameBold: !(f.nameBold ?? true) });
                              }}
                              className="text-xs font-bold"
                            >
                              B
                            </IconBtn>
                            <IconBtn
                              title={`${t("pt.weight")}: ${t("pt.size.price")}`}
                              active={f.priceBold ?? true}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField(f.id, { priceBold: !(f.priceBold ?? true) });
                              }}
                              className="text-xs font-bold"
                            >
                              B
                            </IconBtn>
                          </div>

                          {/* Выравнивание: название / цена / доп. строки — как на вкладке */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              {t("pt.size.name")}
                              <AlignGroup
                                t={t}
                                value={f.nameAlign ?? "left"}
                                onChange={(a) => updateField(f.id, { nameAlign: a })}
                              />
                            </span>
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              {t("pt.size.price")}
                              <AlignGroup
                                t={t}
                                value={f.priceAlign ?? "left"}
                                onChange={(a) => updateField(f.id, { priceAlign: a })}
                              />
                            </span>
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              {t("pt.size.extra")}
                              <AlignGroup
                                t={t}
                                value={f.extraAlign ?? "left"}
                                onChange={(a) => updateField(f.id, { extraAlign: a })}
                              />
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                            {t("ptl.typoHint")}
                          </p>
                        </>
                      ) : toolItem ? (
                        <>
                          {/* Типографика генератора: шрифт + масштаб кегля —
                              действуют на весь текст блока; QR-коды, штрихкоды
                              и рамки остаются базовыми (это не текст) */}
                          <div className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-xs text-slate-400">
                              {t("tape.toolFont")}
                            </span>
                            <select
                              value={f.typo?.fontFamily ?? ""}
                              onChange={(e) =>
                                updateField(f.id, {
                                  typo: {
                                    scale: f.typo?.scale ?? 1,
                                    ...(e.target.value
                                      ? { fontFamily: e.target.value }
                                      : {}),
                                  },
                                })
                              }
                              aria-label={t("tape.toolFontAria")}
                              className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              <option value="">{t("tape.toolFontDefault")}</option>
                              {FONT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-xs text-slate-400">
                              {t("tape.toolScale")}
                            </span>
                            <select
                              value={String(f.typo?.scale ?? 1)}
                              onChange={(e) =>
                                updateField(f.id, {
                                  typo: {
                                    scale: Number(e.target.value),
                                    ...(f.typo?.fontFamily
                                      ? { fontFamily: f.typo.fontFamily }
                                      : {}),
                                  },
                                })
                              }
                              aria-label={t("tape.toolScaleAria")}
                              className={selectCls}
                            >
                              {/* текущее значение всегда в списке — даже если
                                  пришло из бэкапа вне пресетов */}
                              {Array.from(new Set<number>([...TOOL_SCALES, f.typo?.scale ?? 1]))
                                .sort((a, b) => a - b)
                                .map((v) => (
                                  <option key={v} value={String(v)}>
                                    {Math.round(v * 100)}%
                                  </option>
                                ))}
                            </select>
                          </div>
                          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                            {t("tape.toolTypoHint")}
                          </p>
                        </>
                      ) : (
                        !divider && !ruler &&
                        (() => {
                          const tf = f as TextFieldItem;
                          return (
                          <>
                            {/* Мини-Word, строка 1: шрифт + размер */}
                            <div className="flex items-center gap-2">
                              <span className="w-12 shrink-0 text-xs text-slate-400">
                                {t("tt.font")}
                              </span>
                              <select
                                value={tf.fontFamily}
                                onChange={(e) => updateField(f.id, { fontFamily: e.target.value })}
                                aria-label={t("tt.fontAria")}
                                className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              >
                                {FONT_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <SizeSelect
                                t={t}
                                value={tf.fontSize}
                                onChange={(v) => updateField(f.id, { fontSize: v })}
                              />
                            </div>
                            {/* Мини-Word, строка 2: начертание · выравнивание · регистр */}
                            <div className="flex items-center gap-1">
                              <span className="mr-1 w-12 shrink-0 text-xs text-slate-400">
                                {t("tt.format")}
                              </span>
                              <IconBtn
                                title={t("tt.bold")}
                                active={tf.bold}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateField(f.id, { bold: !tf.bold });
                                }}
                                className="text-xs font-bold"
                              >
                                B
                              </IconBtn>
                              <IconBtn
                                title={t("tt.italic")}
                                active={!!tf.italic}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateField(f.id, { italic: !tf.italic });
                                }}
                                className="text-xs font-bold"
                              >
                                <span className="italic">{t("tt.italicGlyph")}</span>
                              </IconBtn>
                              <IconBtn
                                title={t("tt.underline")}
                                active={!!tf.underline}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateField(f.id, { underline: !tf.underline });
                                }}
                                className="text-xs font-bold"
                              >
                                <span className="underline">U</span>
                              </IconBtn>
                              <IconBtn
                                title={t("tt.strike")}
                                active={!!tf.strike}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateField(f.id, { strike: !tf.strike });
                                }}
                                className="text-xs font-bold"
                              >
                                <span className="line-through">S</span>
                              </IconBtn>
                              <div className="mx-1 h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />
                              <AlignGroup t={t} value={currentAlign(tf)} onChange={(a) => setAlign(tf, a)} />
                              <div className="mx-1 h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />
                              <IconBtn
                                title={t("tt.upper")}
                                active={!!tf.upper}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateField(f.id, { upper: !tf.upper });
                                }}
                                className="text-xs font-bold"
                              >
                                <span className="text-[11px] leading-none">
                                  {t("tt.caseGlyph")}
                                </span>
                              </IconBtn>
                            </div>
                            {/* Мини-Word, строка 3: межстрочный интервал */}
                            <div className="flex items-center gap-2">
                              <span className="w-12 shrink-0 text-xs text-slate-400">
                                {t("tt.spacing")}
                              </span>
                              <select
                                value={String(tf.lineHeight ?? 1.25)}
                                onChange={(e) =>
                                  updateField(f.id, { lineHeight: Number(e.target.value) })
                                }
                                aria-label={t("tt.spacing")}
                                className={selectCls}
                              >
                                <option value="1">1</option>
                                <option value="1.25">1.25</option>
                                <option value="1.5">1.5</option>
                                <option value="2">2</option>
                              </select>
                            </div>
                            {/* Мини-Word, строка 4: рамка вокруг блока (по ширине
                                строк; перенос на другую страницу — своя рамка) */}
                            <div className="flex items-center gap-2">
                              <span className="w-12 shrink-0 text-xs text-slate-400">
                                {t("tt.frame")}
                              </span>
                              <select
                                value={tf.frame ?? "none"}
                                onChange={(e) =>
                                  updateField(f.id, {
                                    frame:
                                      e.target.value === "none"
                                        ? undefined
                                        : (e.target.value as TextFrameStyle),
                                  })
                                }
                                aria-label={t("tt.frameAria")}
                                className={selectCls}
                              >
                                <option value="none">{t("tt.frameNone")}</option>
                                <option value="solid">{t("tt.frameSolid")}</option>
                                <option value="dashed">{t("tt.frameDashed")}</option>
                                <option value="dotted">{t("tt.frameDotted")}</option>
                                <option value="double">{t("tt.frameDouble")}</option>
                              </select>
                            </div>
                          </>
                          );
                        })()
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums text-slate-400">
                          {sizeMeta}
                          {elPage !== undefined
                            ? ` · ${t("tape.pageLabel", { n: elPage + 1, mm: Math.round((layout.pages[elPage]?.height ?? 0) / PX_PER_MM) })}`
                            : ""}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Дублировать + Удалить — правый нижний угол, у всех типов одинаково */}
                  <CornerActions
                    dupLabel={t("tt.duplicate")}
                    delLabel={t("tt.deleteLine")}
                    onDuplicate={() => duplicateItem(f.id)}
                    onRemove={() => removeField(f.id)}
                  />
                </div>
              );
            })}
          </div>

          {/* Высота этикетки (длина ленты) — общий контрол со вкладками */}
          <LabelSizeControl t={t} />
        </div>
      </LeftPanel>

      {/* ------------------------ Правая панель ------------------------- */}
      <RightPanel>
        <PreviewHeader
          t={t}
          actions={
            <>
              {/* Копии — компактно в строке предпросмотра;
                  1 = один экземпляр (дублирования нет) */}
              <label className="mr-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className="shrink-0">{t("copies.title")}</span>
                <input
                  key={copies.copies}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={COPIES_MAX}
                  defaultValue={String(copies.copies)}
                  aria-label={t("copies.countAria")}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const v = Number(raw);
                    const next =
                      raw === "" || !Number.isFinite(v) ? 1 : clampCopies(v);
                    setCopies((prev) => ({ ...prev, copies: next }));
                    e.target.value = String(next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-6 w-11 rounded-full border border-slate-200 bg-white px-1 text-center text-[11px] font-medium tabular-nums text-slate-700 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
              </label>
              <Pill>
                {fixedPageHeight
                  ? t("tt.pillHeight", {
                      mm: labelSize.heightMm,
                      px: fixedPageHeight,
                    })
                  : "58 мм · 384px · 1:1"}
              </Pill>
              <Pill>{t("tape.pillPages", { n: layout.pages.length })}</Pill>
              {layout.pages.length > 0 && <Pill>{t("tape.pillLen", { mm: totalMm })}</Pill>}
            </>
          }
        />
        <PreviewBody>
          {banner && <FlatBanner text={banner} />}
          <div className="mx-auto w-full max-w-[560px] p-2.5">
            <div className="overflow-x-auto pb-2">
              <div className="mx-auto flex w-[384px] flex-col gap-4">
                {layout.pages.length === 0 && (
                  <div
                    onDragOver={(e) => handleDragOver(e, -1)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, -1)}
                    className={cn(
                      "flex h-52 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-center transition-colors",
                      dropTarget?.page === -1
                        ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-900"
                        : "border-slate-300 dark:border-slate-700"
                    )}
                  >
                    <Layers className="h-6 w-6 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium text-slate-400">{t("tape.dropEmpty")}</p>
                    <p className="text-xs text-slate-300 dark:text-slate-600">
                      {t("tape.dropEmptyHint")}
                    </p>
                  </div>
                )}
                {layout.pages.map((page) => (
                  <div key={page.index}>
                    <div className="flex items-center justify-between gap-2 pb-1">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {t("tape.pageLabel", {
                          n: page.index + 1,
                          mm: Math.round(page.height / PX_PER_MM),
                        })}
                      </span>
                      {/* Сохранить страницу картинкой (v1.0.27): PNG в полном
                          качестве 4×, имя mxw01-page-N-дата.png */}
                      <button
                        type="button"
                        data-testid="tape-save-page"
                        title={t("tape.saveImg")}
                        aria-label={t("tape.saveImg")}
                        onClick={() => void handleSavePage(page)}
                        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <Save className="h-3.5 w-3.5" />
                        PNG
                      </button>
                    </div>
                    <div
                      onDragOver={(e) => handleDragOver(e, page.index)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, page.index)}
                      className={cn(
                        "relative overflow-hidden rounded-lg border bg-white shadow-md shadow-slate-900/5 transition-colors",
                        dropTarget?.page === page.index
                          ? "border-slate-900 dark:border-slate-100"
                          : "border-slate-200 dark:border-slate-700"
                      )}
                    >
                      <PageCanvas page={page} version={assetVersion} t={t} lang={lang} />
                      {dropTarget?.page === page.index && (
                        <div
                          className="pointer-events-none absolute inset-x-0 h-0.5 bg-slate-900 dark:bg-slate-100"
                          style={{ top: dropTarget.y - 1 }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {layout.pages.length > 1 && (
              <p className="pt-1 text-center text-xs text-slate-400 dark:text-slate-500">
                {t("tape.multiPage")}
              </p>
            )}
          </div>
        </PreviewBody>
        <PrintDock
          t={t}
          onClick={handlePrint}
          disabled={!items.length}
          loading={printing || status === "printing"}
          label={printing || status === "printing" ? t("common.printing") : t("common.print")}
        />
      </RightPanel>

      {/* Скрытые input загрузки файлов */}
      <input
        ref={svgInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleSvgFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleImageFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={ptCsvInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handlePtCsvFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </Workspace>
  );
}
