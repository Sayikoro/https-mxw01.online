/**
 * ============================================================================
 *  СВОИ ШАБЛОНЫ ЦЕННИКОВ — слой приложения.
 * ============================================================================
 *  Пользователь сохраняет текущий ценник как шаблон (название + поля товара
 *  + строки с подстановками). Шаблоны живут в localStorage под ключом
 *  mxw01-pricetag-templates и входят в файл бэкапа (backup.ts).
 *
 *  Встроенных (заводских) шаблонов в приложении больше нет — только свои.
 *  Драйвер принтера здесь не участвует.
 * ============================================================================
 */
import { createId } from "./types";
import type { Pricetag } from "./types";

/** Ключ localStorage со списком своих шаблонов */
export const USER_TEMPLATES_KEY = "mxw01-pricetag-templates";

export interface UserTemplate {
  id: string;
  label: string;
  /** ISO-дата создания */
  createdAt: string;
  /** Сохранённые поля товара (без id) */
  data: Omit<Pricetag, "id">;
}

/** Строка или число → строка; остальное → пустая строка */
function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Починить одну запись шаблона из старых/битых данных */
export function normalizeUserTemplate(raw: unknown): UserTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<UserTemplate> & { data?: Partial<Pricetag> };
  if (!t.data || typeof t.data !== "object") return null;
  const d = t.data;
  // unknown — чтобы честно учесть битые записи (строка вместо массива)
  const rawLines: unknown = d.extraLines;
  return {
    id: typeof t.id === "string" && t.id ? t.id : createId(),
    label:
      typeof t.label === "string" && t.label.trim() ? t.label.trim() : "Без названия",
    createdAt: typeof t.createdAt === "string" ? t.createdAt : "",
    data: {
      name: str(d.name),
      price: str(d.price),
      oldPrice: str(d.oldPrice),
      qr: str(d.qr),
      sku: str(d.sku),
      barcode: str(d.barcode),
      // массив → как есть; строка → разбить по переводам строк; иначе → пустые
      extraLines: Array.isArray(rawLines)
        ? rawLines.map((l) => String(l ?? ""))
        : typeof rawLines === "string" && rawLines.length
          ? rawLines.split("\n")
          : ["", "", ""],
    },
  };
}

/** Починить список шаблонов (битые записи отбрасываются, id не дублируются) */
export function normalizeUserTemplates(raw: unknown): UserTemplate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: UserTemplate[] = [];
  for (const item of raw) {
    const tpl = normalizeUserTemplate(item);
    if (!tpl) continue;
    if (seen.has(tpl.id)) tpl.id = createId();
    seen.add(tpl.id);
    out.push(tpl);
  }
  return out;
}

/** Прочитать свои шаблоны из localStorage */
export function loadUserTemplates(): UserTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USER_TEMPLATES_KEY);
    if (!raw) return [];
    return normalizeUserTemplates(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Записать свои шаблоны в localStorage */
export function saveUserTemplates(list: UserTemplate[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(list));
}

/** Создать шаблон из текущего ценника (id ценника не переносится) */
export function makeUserTemplate(label: string, tag: Pricetag): UserTemplate {
  const { id: _id, ...data } = tag;
  return {
    id: createId(),
    label: label.trim() || (tag.name.trim() ? tag.name.trim() : "Без названия"),
    createdAt: new Date().toISOString(),
    data: { ...data, extraLines: [...tag.extraLines] },
  };
}

/** Применить шаблон: новый ценник с полями шаблона */
export function applyUserTemplate(tpl: UserTemplate): Pricetag {
  return {
    ...tpl.data,
    extraLines: [...tpl.data.extraLines],
    id: createId(),
  };
}
