/**
 * ============================================================================
 *  ГЕНЕРАТОРЫ ЛЕНТЫ (бывшая вкладка «Инструменты») — слой приложения.
 * ============================================================================
 *  Каждый ToolItem ленты рисуется рендерерами tools-render.ts в бинарный
 *  канвас 384×N, который нарезается на чанки ≤ страницы и раскладывается
 *  по страницам ленты как строки потока. Превью = печать (WYSIWYG).
 *
 *  Здесь: дефолты форм, санитизация данных из localStorage/бэкапа,
 *  однократный перенос черновиков со старой вкладки «Инструменты»
 *  (mxw01-tool-*) и кэш рендера+нарезки по содержимому.
 *
 *  Драйвер принтера не участвует: печать идёт через общий пайплайн ленты.
 * ============================================================================
 */
import {
  TAPE_TOOL_IDS,
  TAPE_PAGE_MAX_PX,
  TOOL_SCALE_MAX,
  TOOL_SCALE_MIN,
} from "./types";
import type {
  TapeToolData,
  TapeToolId,
  ToolItem,
  ToolTypo,
} from "./types";
import type { Translator } from "./i18n";
import type { Lang } from "./i18n";
import { chunkCanvasByHeight } from "./tools-canvas";
import {
  renderCalendar,
  renderChecklist,
  renderDates,
  renderHabits,
  renderNumbers,
  renderQr,
  renderReceipt,
  renderReplacement,
  renderWifi,
} from "./tools-render";
import { todayISO } from "./tools-data";
import type { WifiEnc } from "./tools-data";

/* ------------------------------------------------------------------ */
/* Дефолты форм                                                        */
/* ------------------------------------------------------------------ */

/** Дефолты данных по каждому инструменту (как у форм вкладки раньше) */
export function toolDefaults(tool: TapeToolId): TapeToolData {
  switch (tool) {
    case "qr":
      return { text: "", caption: "", level: "M" };
    case "wifi":
      return { ssid: "", password: "", enc: "wpa" as WifiEnc, hidden: false };
    case "checklist":
      return { title: "", items: [] };
    case "receipt":
      return { shop: "", showDate: true, items: [], discount: 0, footer: "" };
    case "dates":
      return {
        name: "",
        made: todayISO(),
        amount: 12,
        unit: "month",
        showMade: true,
        showUntil: true,
        border: true,
      };
    case "numbers":
      return { prefix: "", postfix: "", start: 1, count: 10, pad: 3, barcode: false };
    case "calendar":
      return {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        weekStart: 1,
        weekends: true,
      };
    case "habits":
      return {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        habits: [],
      };
    case "replace":
      return {
        name: "",
        date: todayISO(),
        amount: 3,
        unit: "month",
        showNext: true,
        border: true,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Санитизация данных из localStorage / бэкапа                         */
/* ------------------------------------------------------------------ */

const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** Строка или «пусто»; бэкап мог прийти от другой версии */
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const LIST_ITEMS_MAX = 200;

/**
 * Починить данные инструмента из старых/битых значений: недостающие поля
 * добираются дефолтами, типы приводятся, массивы ограничиваются.
 * Неизвестный tool → null (элемент отбрасывается).
 */
export function sanitizeToolData(tool: TapeToolId, raw: unknown): TapeToolData {
  const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = toolDefaults(tool);
  switch (tool) {
    case "qr":
      return {
        text: str(rawObj.text),
        caption: str(rawObj.caption),
        level: (["L", "M", "Q", "H"] as const).includes(rawObj.level as "L")
          ? (rawObj.level as "L" | "M" | "Q" | "H")
          : "M",
      };
    case "wifi":
      return {
        ssid: str(rawObj.ssid),
        password: str(rawObj.password),
        enc: (["wpa", "wep", "nopass"] as const).includes(rawObj.enc as WifiEnc)
          ? (rawObj.enc as WifiEnc)
          : "wpa",
        hidden: Boolean(rawObj.hidden),
      };
    case "checklist": {
      const items = Array.isArray(rawObj.items) ? rawObj.items.slice(0, LIST_ITEMS_MAX) : [];
      void d;
      return {
        title: str(rawObj.title),
        items: items.map((it, i) => {
          const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
          return {
            id: typeof o.id === "string" && o.id ? o.id : `chk-${i}-${i}`,
            text: str(o.text),
            done: Boolean(o.done),
          };
        }),
      };
    }
    case "receipt": {
      const items = Array.isArray(rawObj.items) ? rawObj.items.slice(0, LIST_ITEMS_MAX) : [];
      return {
        shop: str(rawObj.shop),
        showDate: rawObj.showDate === undefined ? true : Boolean(rawObj.showDate),
        items: items.map((it, i) => {
          const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
          return {
            id: typeof o.id === "string" && o.id ? o.id : `pos-${i}`,
            name: str(o.name),
            price: Math.max(0, Number(o.price) || 0),
            qty: Math.max(1, Math.floor(Number(o.qty) || 1)),
          };
        }),
        discount: clampNum(rawObj.discount, 0, 90, 0),
        footer: str(rawObj.footer),
      };
    }
    case "dates":
      return {
        name: str(rawObj.name),
        made: /^\d{4}-\d{2}-\d{2}$/.test(str(rawObj.made)) ? str(rawObj.made) : todayISO(),
        amount: clampNum(rawObj.amount, 1, 9999, 12),
        unit: (["day", "month", "year"] as const).includes(rawObj.unit as "day")
          ? (rawObj.unit as "day" | "month" | "year")
          : "month",
        showMade: rawObj.showMade === undefined ? true : Boolean(rawObj.showMade),
        showUntil: rawObj.showUntil === undefined ? true : Boolean(rawObj.showUntil),
        border: rawObj.border === undefined ? true : Boolean(rawObj.border),
      };
    case "numbers":
      return {
        prefix: str(rawObj.prefix),
        postfix: str(rawObj.postfix),
        start: clampNum(rawObj.start, 0, 999_999_999, 1),
        count: clampNum(rawObj.count, 1, 200, 10),
        pad: clampNum(rawObj.pad, 0, 12, 3),
        barcode: Boolean(rawObj.barcode),
      };
    case "calendar":
      return {
        year: clampNum(rawObj.year, 1970, 2100, new Date().getFullYear()),
        month: clampNum(rawObj.month, 1, 12, new Date().getMonth() + 1),
        weekStart: rawObj.weekStart === 0 ? 0 : 1,
        weekends: rawObj.weekends === undefined ? true : Boolean(rawObj.weekends),
      };
    case "habits":
      return {
        year: clampNum(rawObj.year, 1970, 2100, new Date().getFullYear()),
        month: clampNum(rawObj.month, 1, 12, new Date().getMonth() + 1),
        habits: (Array.isArray(rawObj.habits) ? rawObj.habits : [])
          .slice(0, 6)
          .map((h) => str(h)),
      };
    case "replace":
      return {
        name: str(rawObj.name),
        date: /^\d{4}-\d{2}-\d{2}$/.test(str(rawObj.date)) ? str(rawObj.date) : todayISO(),
        amount: clampNum(rawObj.amount, 1, 9999, 3),
        unit: (["day", "month", "year"] as const).includes(rawObj.unit as "day")
          ? (rawObj.unit as "day" | "month" | "year")
          : "month",
        showNext: rawObj.showNext === undefined ? true : Boolean(rawObj.showNext),
        border: rawObj.border === undefined ? true : Boolean(rawObj.border),
      };
  }
}

/* ------------------------------------------------------------------ */
/* Черновики старой вкладки «Инструменты» (mxw01-tool-*)               */
/* ------------------------------------------------------------------ */

const legacyCache = new Map<TapeToolId, Partial<TapeToolData> | null>();

/**
 * Черновик со старой вкладки (ключ mxw01-tool-<id>): при добавлении
 * инструмента на ленту поля подсаживаются из него, чтобы введённое
 * не пропало. Значение читается один раз за сессию.
 */
export function legacyToolDraft(tool: TapeToolId): Partial<TapeToolData> | null {
  if (legacyCache.has(tool)) return legacyCache.get(tool) ?? null;
  legacyCache.set(tool, null);
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`mxw01-tool-${tool}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      const draft = parsed as Partial<TapeToolData>;
      legacyCache.set(tool, draft);
      return draft;
    }
  } catch {
    /* битый JSON — без черновика */
  }
  return null;
}

/** Создать данные нового элемента: дефолты + черновик старой вкладки */
export function makeToolData(tool: TapeToolId): TapeToolData {
  const draft = legacyToolDraft(tool);
  return sanitizeToolData(tool, draft ? { ...toolDefaults(tool), ...draft } : toolDefaults(tool));
}

/** Собрать ToolItem (id и служебные поля проставляет вызывающий код) */
export function makeToolItemBase(tool: TapeToolId): Pick<ToolItem, "tool" | "data" | "x" | "y"> {
  return { tool, data: makeToolData(tool), x: 0, y: 0 };
}

/**
 * Починить типографику генератора из localStorage/бэкапа. undefined (поля
 * нет у старых элементов) — рендер по умолчанию; мусорные значения зажимаются.
 * fontFamily undefined/пустая — ролевые шрифты (чек остаётся моноширинным).
 */
export function sanitizeToolTypo(raw: unknown): ToolTypo | undefined {
  if (raw === undefined || raw === null) return undefined;
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = Number(o.scale);
  const scale =
    Number.isFinite(n) && n > 0
      ? Math.min(TOOL_SCALE_MAX, Math.max(TOOL_SCALE_MIN, n))
      : 1;
  const rawFam = typeof o.fontFamily === "string" ? o.fontFamily.trim() : "";
  return { scale, ...(rawFam ? { fontFamily: rawFam } : {}) };
}

/* ------------------------------------------------------------------ */
/* Рендер + нарезка на чанки (кэш по содержимому)                      */
/* ------------------------------------------------------------------ */

export interface TapeI18n {
  t: Translator;
  lang: Lang;
}

const FALLBACK_I18N: TapeI18n = {
  t: ((key: string) => key) as Translator,
  lang: "ru",
};

function renderTool(
  tool: TapeToolId,
  data: TapeToolData,
  i18n: TapeI18n,
  typo?: ToolTypo
): { canvas: HTMLCanvasElement; boundaries: number[] } | null {
  const { t, lang } = i18n;
  switch (tool) {
    case "qr":
      return renderQr(data as Parameters<typeof renderQr>[0], t, lang, typo);
    case "wifi":
      return renderWifi(data as Parameters<typeof renderWifi>[0], t, lang, typo);
    case "checklist":
      return renderChecklist(data as Parameters<typeof renderChecklist>[0], t, lang, typo);
    case "receipt":
      return renderReceipt(data as Parameters<typeof renderReceipt>[0], t, lang, typo);
    case "dates":
      return renderDates(data as Parameters<typeof renderDates>[0], t, lang, typo);
    case "numbers":
      return renderNumbers(data as Parameters<typeof renderNumbers>[0], t, lang, typo);
    case "calendar":
      return renderCalendar(data as Parameters<typeof renderCalendar>[0], t, lang, typo);
    case "habits":
      return renderHabits(data as Parameters<typeof renderHabits>[0], t, lang, typo);
    case "replace":
      return renderReplacement(data as Parameters<typeof renderReplacement>[0], t, lang, typo);
  }
}

interface ChunkEntry {
  chunks: HTMLCanvasElement[];
}

const chunkCache = new Map<string, ChunkEntry>();

/**
 * Канвас инструмента, нарезанный на чанки ≤ maxPx (страницы ленты).
 * Разрывы — по границам фрагментов рендерера (не режем строку/метку).
 * Кэш по содержимому: перерисовывается только изменённый инструмент.
 */
export function toolItemChunks(
  item: Pick<ToolItem, "tool" | "data" | "typo">,
  maxPx: number,
  i18n: TapeI18n | undefined
): HTMLCanvasElement[] {
  if (typeof document === "undefined") return [];
  // Чек печатает текущее время — раз в минуту кэш обновляется сам
  const tick = item.tool === "receipt" ? Math.floor(Date.now() / 60_000) : 0;
  // Типографика в ключе кэша: смена шрифта/масштаба перерисовывает блок
  const typoKey = item.typo ? JSON.stringify(item.typo) : "";
  const key = `${item.tool}|${maxPx}|${i18n?.lang ?? "ru"}|${tick}|${JSON.stringify(item.data)}|${typoKey}`;
  const hit = chunkCache.get(key);
  if (hit) return hit.chunks;

  const result = renderTool(item.tool, item.data, i18n ?? FALLBACK_I18N, item.typo);
  const chunks = result ? chunkCanvasByHeight(result.canvas, maxPx, result.boundaries) : [];
  if (chunkCache.size > 24) chunkCache.clear();
  chunkCache.set(key, { chunks });
  return chunks;
}

/** Высота первого чанка (для подписи размера в карточке) */
export function toolChunksHeightPx(chunks: HTMLCanvasElement[]): number {
  return chunks.reduce((s, c) => s + c.height, 0);
}

/** Все id инструментов из localStorage-значения (для нормализации) */
export function isKnownToolId(v: unknown): v is TapeToolId {
  return typeof v === "string" && TAPE_TOOL_IDS.includes(v as TapeToolId);
}

/** Максимальная высота страницы ленты — по ней нарезаются чанки */
export const TOOL_CHUNK_MAX_PX = TAPE_PAGE_MAX_PX;
