/**
 * Общие типы страницы печати MXW01.
 *
 * ВАЖНО: этот файл описывает только ДАННЫЕ редактора (ценники, текстовые поля,
 * настройки типографии). Логика драйвера и отправки на печать находится
 * исключительно в библиотеке `mxw01-thermal-printer` и НЕ изменяется.
 */
import type { DurationUnit, ReceiptItem, WifiData } from "./tools-data";

/** Ширина печатающей головки MXW01 в точках (пикселях) */
export const PRINTER_HEAD_WIDTH = 384;

/** Базовый DPI, относительно которого считается масштаб (как в оригинале: 168) */
export const BASE_DPI = 168;

/**
 * Ширина ленты пользователя в мм — все пропорции рендера (предпросмотр и
 * печать) рассчитываются исходя из неё: 384 точки головки = 55 мм бумаги
 * (физическая лента — 58 мм, зона печати уже).
 */
export const TAPE_WIDTH_MM = 55;

/**
 * Физическая ширина ленты в мм — для подписей интерфейса (58 мм).
 */
export const TAPE_PHYSICAL_MM = 58;

/**
 * Ширина зоны печати MXW01 в мм: головка 384 точки при 203 DPI
 * (8 точек/мм) = 48 мм. Физическая лента шире (58 мм), поля по краям
 * не печатают. Подтверждено контрольной линейкой: печать идёт по формуле
 * мм = px / 203 × 25.4, т.е. 1 px = 1/8 мм.
 */
export const PRINTABLE_WIDTH_MM = 48;

/**
 * Пикселей печати на миллиметр длины ленты: 384 точки / 48 мм зоны
 * печати = 8 точек/мм (203 DPI). Через неё считаются длина ленты в мм
 * и фиксированные высоты этикеток (50 мм = 400 px).
 */
export const PX_PER_MM = PRINTER_HEAD_WIDTH / PRINTABLE_WIDTH_MM;

/** Максимальная длина печати, мм (потолок одной страницы ленты) */
export const TAPE_PAGE_MAX_MM = 90;

/** Максимальная высота страницы ленты, px: 90 мм = 720 px */
export const TAPE_PAGE_MAX_PX = Math.floor(TAPE_PAGE_MAX_MM * PX_PER_MM);

/**
 * Нативное разрешение головки на ленте 55 мм: 384 точки на 55 мм ≈ 177 DPI.
 * При масштабе 1.00x (style.dpi = TAPE_DPI) один пиксель холста равен одной
 * точке печати — это максимальное качество, которое физически выдаёт принтер.
 */
export const TAPE_DPI = Math.round((PRINTER_HEAD_WIDTH * 25.4) / TAPE_WIDTH_MM); // 177

/* ------------------------------------------------------------------ */
/* Вкладка «Текст» — кастомные текстовые поля                          */
/* ------------------------------------------------------------------ */

/**
 * Рамка текстового блока: обводит фактическую ширину строк. Если текст
 * переносится на другую страницу, каждая часть получает свою рамку.
 * undefined — без рамки.
 */
export type TextFrameStyle = "solid" | "dashed" | "dotted" | "double";
export const TEXT_FRAME_STYLES: readonly TextFrameStyle[] = [
  "solid",
  "dashed",
  "dotted",
  "double",
];

export interface TextFieldItem {
  id: string;
  /** Содержимое поля (поддерживает переносы строк) */
  text: string;
  /** Левый верхний угол блока в пикселях холста печати (ширина 384) */
  x: number;
  y: number;
  /** Размер шрифта, px */
  fontSize: number;
  bold: boolean;
  /** Курсив */
  italic?: boolean;
  fontFamily: string;
  /** Подчёркнутый (линия под текстом каждой строки) */
  underline?: boolean;
  /** Зачёркнутый (линия через середину строк) */
  strike?: boolean;
  /** ВЕРХНИЙ РЕГИСТР (текст приводится к верхнему регистру при отрисовке) */
  upper?: boolean;
  /** Межстрочный интервал — множитель кегля; undefined = стандартный 1.25 */
  lineHeight?: number;
  /** Рамка вокруг фактической ширины строк; undefined — без рамки */
  frame?: TextFrameStyle;
}

/* ------------------------------------------------------------------ */
/* Лента — генераторы (бывшая вкладка «Инструменты»)                   */
/* ------------------------------------------------------------------ */

/**
 * Инструменты-генераторы ленты. Каждый экземпляр ToolItem на ленте несёт
 * СВОИ данные формы — можно добавить несколько QR/чеков/календарей и т.д.
 */
export type TapeToolId =
  | "qr"
  | "wifi"
  | "checklist"
  | "receipt"
  | "dates"
  | "numbers"
  | "calendar"
  | "habits"
  | "replace";

/** Все id инструментов (для нормализации из localStorage) */
export const TAPE_TOOL_IDS: readonly TapeToolId[] = [
  "qr",
  "wifi",
  "checklist",
  "receipt",
  "dates",
  "numbers",
  "calendar",
  "habits",
  "replace",
];

/* Данные форм инструментов. Схемы хранятся здесь (чистые данные), чтобы
   ToolItem типизировался без циклов: рендереры (tools-render.ts) и формы
   импортируют те же типы. */
// prettier-ignore
export interface QrToolData {
  text: string;
  caption: string;
  level: "L" | "M" | "Q" | "H";
}

export interface ChecklistToolItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ChecklistToolData {
  title: string;
  items: ChecklistToolItem[];
}

/** Позиция чека с id для реакта (в рендер уходят name/price/qty) */
export interface ReceiptToolItem extends ReceiptItem {
  id: string;
}

export interface ReceiptToolData {
  shop: string;
  showDate: boolean;
  items: ReceiptToolItem[];
  discount: number;
  footer: string;
}

export interface DatesToolData {
  name: string;
  /** YYYY-MM-DD */
  made: string;
  amount: number;
  unit: DurationUnit;
  showMade: boolean;
  showUntil: boolean;
  border: boolean;
}

export interface NumbersToolData {
  prefix: string;
  postfix: string;
  start: number;
  count: number;
  pad: number;
  barcode: boolean;
}

export interface CalendarToolData {
  year: number;
  month: number;
  weekStart: 0 | 1;
  weekends: boolean;
}

export interface HabitsToolData {
  year: number;
  month: number;
  habits: string[];
}

export type WifiToolData = WifiData;

/**
 * Этикетка обслуживания «Замена»: что заменено, когда и когда следующая
 * (дата считается автоматически, конец месяца зажимается — как у сроков
 * годности). Наклейка на устройство: фильтры, картриджи, вода и т.п.
 */
export interface ReplacementToolData {
  /** Что заменено (опциональная строка над датой) */
  name: string;
  /** Дата замены (YYYY-MM-DD) */
  date: string;
  /** Через сколько — число */
  amount: number;
  /** Единица срока */
  unit: DurationUnit;
  /** Показывать строку «Следующая: дата» */
  showNext: boolean;
  /** Рамка вокруг блока */
  border: boolean;
}

/**
 * Типографика блока-генератора: шрифт и масштаб кегля применяются ко всему
 * тексту инструмента (заголовки, строки, подписи); QR-коды, штрихкоды и
 * рамки остаются базовыми. fontFamily не задан (undefined) — роли получают
 * исходные шрифты (sans-serif / monospace для «чековых» строк). Поле typo
 * опционально — старые элементы без него рендерятся точно как раньше
 * (scale = 1, ролевые шрифты).
 */
export interface ToolTypo {
  /** Множитель кегля текста (1 = базовые размеры рендерера) */
  scale: number;
  /** CSS font-family (FONT_OPTIONS); undefined — ролевые шрифты по умолчанию */
  fontFamily?: string;
}

/** Границы масштаба текста генератора */
export const TOOL_SCALE_MIN = 0.75;
export const TOOL_SCALE_MAX = 2;

/** Объединение данных всех инструментов (содержимое ToolItem.data) */
export type TapeToolData =
  | QrToolData
  | WifiToolData
  | ChecklistToolData
  | ReceiptToolData
  | DatesToolData
  | NumbersToolData
  | CalendarToolData
  | HabitsToolData
  | ReplacementToolData;

/** Элемент ленты — генератор: канвас инструмента целиком, на всю ширину */
export interface ToolItem {
  id: string;
  kind: "tool";
  /** Горизонтальный отступ (генераторы рисуются на всю ширину — всегда 0) */
  x: number;
  y: number;
  tool: TapeToolId;
  /** Данные формы — схема зависит от tool (TapeToolData) */
  data: TapeToolData;
  /** Типографика блока: шрифт + масштаб кегля (undefined = по умолчанию) */
  typo?: ToolTypo;
  /**
   * Служебное поле рендера (не хранится): индекс чанка канваса инструмента
   * на странице. Длинные генераторы нарезаются на куски ≤ страницы,
   * чанки раскладываются по страницам как строки текста.
   */
  chunk?: number;
}

/** Товар в списке ценников (типографика общая на весь элемент) */
export interface PricetagListTag {
  name: string;
  price: string;
  oldPrice: string;
  sku: string;
  qr: string;
  barcode: string;
  extraLines: string[];
}

/**
 * Список ценников на ленте: несколько товаров с ОБЩЕЙ типографикой,
 * печатаются подряд — каждый цельным блоком. Модель повторяет вкладку
 * «Ценник» (список товаров + один стиль). Рендер — тот же рендерер
 * вкладки: элемент синтезирует PricetagItem на каждый тег.
 */
export interface PricetagListItem {
  id: string;
  kind: "ptlist";
  /** Горизонтальный отступ; вертикаль выводится потоком (y = 0) */
  x: number;
  y: number;
  tags: PricetagListTag[];
  /** Кегль цены, px */
  fontSize: number;
  /** Рамка вокруг ценников (= «Границы» на вкладке «Ценник») */
  frame?: boolean;
  /** Кегль названия; undefined — выводится из кегля цены (×0.55) */
  nameSize?: number;
  /** Кегль доп. строк; undefined — 24 */
  extraSize?: number;
  /** Кегль старой цены; undefined — выводится из кегля цены (×0.42) */
  oldPriceSize?: number;
  nameAlign?: TextAlignment;
  priceAlign?: TextAlignment;
  extraAlign?: TextAlignment;
  fontFamily?: string;
  nameBold?: boolean;
  priceBold?: boolean;
}

/** Максимум ценников в одном списке (защита localStorage) */
export const PTLIST_TAGS_MAX = 300;

/* ------------------------------------------------------------------ */
/* Лента — элементы потока (текст / разделитель / картинка)             */
/* ------------------------------------------------------------------ */

/** Стиль встроенного разделителя строк */
export type DividerStyle = "solid" | "dashed" | "dotted" | "double" | "zigzag";

/** Встроенные стили (порядок = порядок в селекте карточки) */
export const DIVIDER_STYLES: readonly DividerStyle[] = [
  "solid",
  "dashed",
  "dotted",
  "double",
  "zigzag",
];

/** Разделитель — линия между блоками ленты (или поверх текста) */
export interface DividerItem {
  id: string;
  kind: "divider";
  /** Горизонтальный отступ; вертикаль выводится потоком (y = 0) */
  x: number;
  y: number;
  /** Ширина линии, px (до 384) */
  width: number;
  /** Толщина линии, px (1–6) */
  thickness: number;
  style: DividerStyle;
  /** Высота блока: у встроенных выводится из стиля/толщины, у SVG — из пропорций */
  height: number;
  /** «Поверх текста»: не занимает места в потоке, ложится на предыдущий блок */
  overlay?: boolean;
  /** Свой SVG-разделитель (data:image/svg+xml;…) */
  svg?: string;
  /** Отношение высоты/ширины загруженного SVG (для восстановления высоты) */
  ratio?: number;
}

/** Алгоритм дизеринга картинок ленты (те же, что у вкладки «Изображение») */
export type ImageDither = "steinberg" | "bayer" | "atkinson" | "none";

/** Картинка, вписанная в блок ленты */
export interface ImageItem {
  id: string;
  kind: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dither: ImageDither;
  /** −100…100 */
  brightness: number;
  /** −100…100 */
  contrast: number;
}

/**
 * Ценник на ленте — ТА ЖЕ МОДЕЛЬ, что на вкладке «Ценник» (см. pricetags.ts):
 * товар (name/price/oldPrice/sku/qr/barcode) + строки макета extraLines с
 * подстановками {name} {price} {old} {sku} {barcode} + типографика (кегли
 * четырёх элементов, шрифт, жирность, выравнивание, рамка). Печатается тем
 * же рендерером, что и вкладка, — ценник на ленте выглядит 1:1 как там.
 */
export interface PricetagItem {
  id: string;
  kind: "pricetag";
  /** Горизонтальный отступ; вертикаль выводится потоком (y = 0) */
  x: number;
  y: number;
  /** Название товара — подстановка {name} */
  name: string;
  /** Цена («₽» добавляется автоматически, если валюта не указана) */
  price: string;
  /** Старая цена — подстановка {old}, рисуется зачёркнутой */
  oldPrice?: string;
  /** Артикул — подстановка {sku} */
  sku?: string;
  /** QR-код: ссылка или текст (можно с подстановками) — блоком в конце */
  qr?: string;
  /** Штрихкод: EAN-13 (12–13 цифр) или Code-128 — блоком после QR */
  barcode?: string;
  /**
   * Строки макета ценника: поля товара попадают на печать только через
   * подстановки {name} {price} {old} {sku} {barcode} — как на вкладке.
   * Строка «{name}» → кегль названия, «{price}»/«{old}» → кегль цены,
   * остальные → кегль доп. строк.
   */
  extraLines?: string[];
  /** Кегль цены, px */
  fontSize: number;
  /** Рамка вокруг ценника (= «Границы» на вкладке «Ценник») */
  frame?: boolean;
  /** Кегль названия; undefined — выводится из кегля цены (×0.55) */
  nameSize?: number;
  /** Кегль доп. строк; undefined — 24 */
  extraSize?: number;
  /** Кегль старой цены; undefined — выводится из кегля цены (×0.42) */
  oldPriceSize?: number;
  nameAlign?: TextAlignment;
  priceAlign?: TextAlignment;
  extraAlign?: TextAlignment;
  fontFamily?: string;
  nameBold?: boolean;
  priceBold?: boolean;
  /**
   * Служебное поле рендера (не хранится): дотянуть ценник до конца
   * этикетки, px. Ставится только синтезированным элементам страницы
   * в layoutTape при фиксированной длине ленты — рамка растягивается
   * на всю длину, как у вкладки «Ценник» (minHeightPx).
   */
  stretchToPx?: number;
}

/**
 * Линейка — контрольная шкала длины этикетки в миллиметрах.
 *
 * Деления размечаются от 0 (верх блока; на фиксированной этикетке —
 * начало бумаги) до заданной длины той же константой PX_PER_MM, что и
 * расчёт длины этикетки. Инструмент для проверки масштаба печати
 * физической линейкой: если шаг делений на бумаге не равен 1 мм —
 * константа откалибровывается по факту.
 */
export interface RulerItem {
  id: string;
  kind: "ruler";
  x: number;
  y: number;
  /** Длина шкалы, мм (последнее деление = lengthMm) */
  lengthMm: number;
}

/** Границы длины линейки, мм */
export const RULER_MM_MIN = 5;
export const RULER_MM_MAX = 500;

/** Любой элемент ленты (дискриминант по полю kind) */
export type LabelItem =
  | TextFieldItem
  | DividerItem
  | ImageItem
  | PricetagItem
  | RulerItem
  | ToolItem
  | PricetagListItem;

/** Сужение до разделителя */
export function isDivider(it: LabelItem): it is DividerItem {
  return (it as DividerItem).kind === "divider";
}

/** Сужение до линейки */
export function isRuler(it: LabelItem): it is RulerItem {
  return (it as RulerItem).kind === "ruler";
}

/** Сужение до картинки */
export function isImage(it: LabelItem): it is ImageItem {
  return (it as ImageItem).kind === "image";
}

/** Сужение до ценника */
export function isPricetag(it: LabelItem): it is PricetagItem {
  return (it as PricetagItem).kind === "pricetag";
}

/** Сужение до генератора */
export function isTool(it: LabelItem): it is ToolItem {
  return (it as ToolItem).kind === "tool";
}

/** Сужение до списка ценников */
export function isPricetagList(it: LabelItem): it is PricetagListItem {
  return (it as PricetagListItem).kind === "ptlist";
}

/* ------------------------------------------------------------------ */
/* Вкладка «Ценник»                                                    */
/* ------------------------------------------------------------------ */


export interface Pricetag {
  id: string;
  name: string;
  price: string;
  oldPrice: string;
  qr: string;
  /** Артикул товара — подставляется в строки ценника через {sku} */
  sku: string;
  /** Штрихкод: EAN-13 (12–13 цифр) или Code-128; рисуется блоком под QR */
  barcode: string;
  extraLines: string[];
}

export type TextAlignment = "left" | "center" | "right";

export interface PricetagStyle {
  nameSize: number;
  priceSize: number;
  extraSize: number;
  oldPriceSize: number;
  nameAlign: TextAlignment;
  priceAlign: TextAlignment;
  extraAlign: TextAlignment;
  fontFamily: string;
  nameBold: boolean;
  priceBold: boolean;
  borders: boolean;
  dpi: number;
}

/* ------------------------------------------------------------------ */
/* Шрифты                                                              */
/* ------------------------------------------------------------------ */

export const FONT_OPTIONS = [
  { value: "sans-serif", label: "Sans-serif" },
  { value: "serif", label: "Serif (Times)" },
  { value: "monospace", label: "Monospace" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "Impact, sans-serif", label: "Impact" },
  { value: "'Comic Sans MS', cursive", label: "Comic Sans" },
] as const;

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
