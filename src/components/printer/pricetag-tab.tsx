"use client";
/**
 * Вкладка «Ценник» (референс: «Печать ценников»):
 *  • «Товары» — список товаров-чипов, поля Название/Цена/Старая цена/Артикул/QR,
 *    импорт и экспорт CSV, дублирование;
 *  • «Строки ценника» — макет ценника целиком задаётся строками: поля товара
 *    попадают на печать только через подстановки {name}/{price}/{old}/{sku};
 *    порядок строк меняется перетаскиванием (мышь/палец);
 *  • «Типография и печать» — размеры, шрифт, жирность, выравнивание, границы,
 *    масштаб печати (якорь — лента 55 мм, нативные 177 DPI = макс. качество);
 *  • «Мои шаблоны» — сохранение текущего ценника как своего шаблона
 *    (localStorage, входит в бэкап); применение кликом, удаление крестиком;
 *  • справа — предпросмотр карточек и закреплённая кнопка «Печать».
 *
 * Печать выполняется только через контекст принтера (драйвер не изменён).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { usePrinter } from "@/lib/printer/printer-context";
import { useUsbPrinter } from "@/lib/printer/usb/usb-printer-context";
import { useHprtPrinter } from "@/lib/printer/hprt/hprt-printer-context";
import {
  FONT_OPTIONS,
  createId,
  BASE_DPI,
  TAPE_DPI,
  TAPE_WIDTH_MM,
  PRINTER_HEAD_WIDTH,
  PX_PER_MM,
} from "@/lib/printer/types";
import { notePrintedMm } from "@/lib/printer/tape-counter";
import type { Pricetag, PricetagStyle, TextAlignment } from "@/lib/printer/types";
import {
  DEFAULT_STYLE,
  importPricetagsFromCsv,
  importPricetagsFromTable,
  makeEmptyPricetag,
  renderPricetagToCanvas,
  renderPricetagTapeToCanvas,
  seedPlaceholderLines,
} from "@/lib/printer/pricetags";
import { renderCopies } from "@/lib/printer/copies";
import type { CopiesSettings } from "@/lib/printer/copies";
import { DEFAULT_COPIES } from "@/lib/printer/copies";
import {
  loadUserTemplates,
  saveUserTemplates,
  makeUserTemplate,
  applyUserTemplate,
} from "@/lib/printer/user-templates";
import type { UserTemplate } from "@/lib/printer/user-templates";
import { plural } from "@/lib/printer/i18n";
import type { Lang, Translator } from "@/lib/printer/i18n";
import { useLabelSize, labelFixedHeightPx } from "@/lib/printer/label-size";
import {
  Workspace,
  LeftPanel,
  RightPanel,
  PreviewHeader,
  PreviewBody,
  PrintDock,
  ScaleCaption,
  FlatBanner,
  SectionHeader,
  CollapsibleSection,
  Pill,
  IconBtn,
  AlignGroup,
  CopiesControl,
  LabelSizeControl,
} from "./shell";
import { cn } from "@/lib/utils";
import {
  Bookmark,
  BookmarkPlus,
  ClipboardPaste,
  Copy,
  Download,
  GripVertical,
  Minus,
  Package,
  Plus,
  SlidersHorizontal,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";

const LS_TAGS_KEY = "mxw01-pricetags";
const LS_STYLE_KEY = "mxw01-pricetag-style";
/** Флаг однократной миграции: посев подстановок в ценники старых версий */
const LS_SEEDED_KEY = "mxw01-pricetags-placeholders-seeded";

/** Единый стиль плоских полей ввода (как на референсе) */
const FLAT_INPUT =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-xs outline-none transition-colors placeholder:text-slate-300 focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-slate-100";

/** Починить данные из старых версий localStorage (без sku и т.п.) */
function normalizeTag(raw: unknown): Pricetag {
  const t = (raw ?? {}) as Partial<Pricetag>;
  return {
    id: typeof t.id === "string" && t.id ? t.id : createId(),
    name: typeof t.name === "string" ? t.name : "",
    price: typeof t.price === "string" ? t.price : "",
    oldPrice: typeof t.oldPrice === "string" ? t.oldPrice : "",
    qr: typeof t.qr === "string" ? t.qr : "",
    sku: typeof t.sku === "string" ? t.sku : "",
    barcode: typeof t.barcode === "string" ? t.barcode : "",
    extraLines: Array.isArray(t.extraLines)
      ? t.extraLines.map((l) => String(l ?? ""))
      : ["", "", ""],
  };
}

function loadTags(sampleLines: [string, string]): Pricetag[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_TAGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        let tags = parsed.map(normalizeTag);
        // Однократная миграция: в старых версиях название/цена рисовались
        // автоматически, а теперь их нужно вызывать строками — сеем вызовы,
        // чтобы после обновления ценник не оказался пустым. Флаг защищает
        // последующие намеренные правки (удалённую строку {price} и т.п.).
        if (!window.localStorage.getItem(LS_SEEDED_KEY)) {
          tags = seedPlaceholderLines(tags);
          window.localStorage.setItem(LS_SEEDED_KEY, "1");
        }
        return tags;
      }
    }
  } catch {
    /* ignore */
  }
  return [
    normalizeTag({
      id: createId(),
      name: "Galaxy A23",
      price: "5800",
      oldPrice: "",
      qr: "",
      sku: "727",
      extraLines: ["{name}", "{price}", sampleLines[0], sampleLines[1]],
    }),
  ];
}

function loadStyle(): PricetagStyle {
  if (typeof window === "undefined") return DEFAULT_STYLE;
  try {
    const raw = window.localStorage.getItem(LS_STYLE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<PricetagStyle>;
      // Миграция: старый дефолт 168 DPI (пропорции ленты 58 мм) → 177 DPI,
      // чтобы пропорции рендера соответствовали реальной ленте 55 мм.
      if (saved.dpi === BASE_DPI) saved.dpi = TAPE_DPI;
      return { ...DEFAULT_STYLE, ...saved };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_STYLE;
}

/**
 * Пресеты масштаба. Якорь — нативное разрешение ленты 55 мм (TAPE_DPI = 177):
 * 384 px = 55 мм, 1 px = 1 точка печати — максимальное качество.
 * Выше DPI — крупнее текст на бумаге, ниже — мельче.
 */
const DPI_PRESETS: { dpi: number; labelKey: string }[] = [
  { dpi: 150, labelKey: "pt.presetSmall" },
  { dpi: TAPE_DPI, labelKey: "pt.presetTape" },
  { dpi: 203, labelKey: "pt.presetLarge" },
];

/** Подстановки данных товара, доступные в строках ценника */
const PLACEHOLDER_CHIPS: { ph: string; labelKey: string }[] = [
  { ph: "{name}", labelKey: "pt.chip.name" },
  { ph: "{price}", labelKey: "pt.chip.price" },
  { ph: "{old}", labelKey: "pt.chip.old" },
  { ph: "{sku}", labelKey: "pt.chip.sku" },
  { ph: "{qr}", labelKey: "pt.chip.qr" },
  { ph: "{barcode}", labelKey: "pt.chip.barcode" },
];

export function PricetagTab({ t, lang }: { t: Translator; lang: Lang }) {
  const { status, printCanvas, connect } = usePrinter();
  const { transport, printCanvas: printUsb } = useUsbPrinter();
  const { printCanvas: printHprt } = useHprtPrinter();
  const { toast } = useToast();

  const [tags, setTags] = useState<Pricetag[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [style, setStyle] = useState<PricetagStyle>(DEFAULT_STYLE);
  // Высота этикетки (длина ленты) — общий стор со вкладкой «Лента»/настройками:
  // фиксированная длина задаёт МИНИМАЛЬНУЮ высоту каждого ценника (мм → точки)
  const [labelSize] = useLabelSize();
  const minHeightPx = labelFixedHeightPx(labelSize);
  const [banner, setBanner] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [linesOpen, setLinesOpen] = useState(true);
  const [typeOpen, setTypeOpen] = useState(false);
  const [dragLineIndex, setDragLineIndex] = useState<number | null>(null);
  const [copies, setCopies] = useState<CopiesSettings>(DEFAULT_COPIES);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  // Свои шаблоны: список + имя в поле ввода
  const [userTpls, setUserTpls] = useState<UserTemplate[]>([]);
  const [tplLabel, setTplLabel] = useState("");
  const [myTplsOpen, setMyTplsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const tapeCanvasRef = useRef<HTMLCanvasElement>(null);
  const lineRowsRef = useRef<Map<number, HTMLElement>>(new Map());
  const lineDragRef = useRef<{ index: number } | null>(null);
  const lastLineFocusRef = useRef<number | null>(null);

  useEffect(() => {
    const loaded = loadTags([t("pt.sampleMemory"), t("pt.sampleSku", { sku: "{sku}" })]);
    setTags(loaded);
    setActiveId(loaded[0]?.id ?? null);
    setStyle(loadStyle());
    setUserTpls(loadUserTemplates());
  }, []);

  useEffect(() => {
    if (tags.length) window.localStorage.setItem(LS_TAGS_KEY, JSON.stringify(tags));
  }, [tags]);
  useEffect(() => {
    window.localStorage.setItem(LS_STYLE_KEY, JSON.stringify(style));
  }, [style]);
  useEffect(() => {
    saveUserTemplates(userTpls);
  }, [userTpls]);

  const active = useMemo(() => tags.find((t) => t.id === activeId) ?? null, [tags, activeId]);

  // Перерисовка превью при изменении данных и длины этикетки
  useEffect(() => {
    for (const tag of tags) {
      const canvas = previewsRef.current.get(tag.id);
      if (canvas) renderPricetagToCanvas(canvas, tag, style, { minHeightPx });
    }
  }, [tags, style, minHeightPx]);

  const updateActive = useCallback(
    (patch: Partial<Pricetag>) => {
      if (!activeId) return;
      setTags((prev) => prev.map((t) => (t.id === activeId ? { ...t, ...patch } : t)));
    },
    [activeId]
  );

  /* --- Свои шаблоны: сохранить / применить / удалить --- */

  /** Сохранить текущий ценник как шаблон */
  const saveTpl = useCallback(() => {
    if (!active) return;
    const tpl = makeUserTemplate(tplLabel, active);
    setUserTpls((prev) => [tpl, ...prev]);
    setTplLabel("");
    setMyTplsOpen(true);
    toast({ title: t("pt.tplSaved", { label: tpl.label }), description: t("pt.tplSavedDesc") });
  }, [active, tplLabel, toast, t]);

  /** Применить шаблон: к текущему ценнику (с заменой полей) или новым */
  const applyTplNow = useCallback(
    (tpl: UserTemplate) => {
      const tag = applyUserTemplate(tpl);
      setTags((prev) => {
        if (active) {
          return prev.map((t) => (t.id === active.id ? { ...tag, id: t.id } : t));
        }
        return [...prev, tag];
      });
      if (!active) setActiveId(tag.id);
      toast({
        title: t("pt.tplApplied", { label: tpl.label }),
        description: active ? t("pt.tplAppliedTo") : t("pt.tplCreatedNew"),
      });
    },
    [active, toast, t]
  );

  /** Удалить свой шаблон */
  const deleteTpl = useCallback(
    (tplId: string) => {
      setUserTpls((prev) => {
        const tpl = prev.find((x) => x.id === tplId);
        if (tpl) toast({ title: t("pt.tplDeleted", { label: tpl.label }) });
        return prev.filter((x) => x.id !== tplId);
      });
    },
    [toast, t]
  );

  /* --- Перетаскивание строк ценника (мышь + палец, Pointer Events) --- */

  const beginLineDrag = useCallback(
    (e: React.PointerEvent, index: number) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      lineDragRef.current = { index };
      setDragLineIndex(index);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* нет поддержки — не критично */
      }
    },
    []
  );

  const moveLineDrag = useCallback(
    (e: React.PointerEvent) => {
      const st = lineDragRef.current;
      if (!st || !active) return;
      // над какой строкой сейчас курсор/палец
      let target = st.index;
      for (const [i, el] of lineRowsRef.current) {
        const r = el.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          target = i;
          break;
        }
      }
      if (target === st.index) return;
      const next = [...active.extraLines];
      const [moved] = next.splice(st.index, 1);
      next.splice(target, 0, moved);
      st.index = target;
      setDragLineIndex(target);
      updateActive({ extraLines: next });
    },
    [active, updateActive]
  );

  const endLineDrag = useCallback((e: React.PointerEvent) => {
    if (!lineDragRef.current) return;
    lineDragRef.current = null;
    setDragLineIndex(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* нет поддержки — не критично */
    }
  }, []);

  /** Вставить подстановку ({name} и т.п.) в текущую/последнюю строку */
  const insertPlaceholder = useCallback(
    (ph: string) => {
      if (!active) return;
      const lines = [...active.extraLines];
      if (!lines.length) lines.push("");
      let idx = lastLineFocusRef.current;
      if (idx === null || idx >= lines.length) idx = lines.length - 1;
      lines[idx] = (lines[idx] ?? "") + ph;
      lastLineFocusRef.current = idx;
      updateActive({ extraLines: lines });
    },
    [active, updateActive]
  );

  const addTag = useCallback(() => {
    const t = makeEmptyPricetag();
    setTags((prev) => [...prev, t]);
    setActiveId(t.id);
  }, []);

  const duplicateTag = useCallback(() => {
    if (!active) return;
    const copy: Pricetag = { ...active, id: createId(), extraLines: [...active.extraLines] };
    setTags((prev) => [...prev, copy]);
    setActiveId(copy.id);
    toast({ title: t("pt.duplicated"), description: t("pt.duplicatedDesc") });
  }, [active, toast, t]);

  const removeTag = useCallback(
    (id: string) => {
      setTags((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeId]
  );

  const onCsv = useCallback(
    async (file: File) => {
      const text = await file.text();
      const imported = importPricetagsFromCsv(text);
      if (!imported.length) {
        toast({
          title: t("pt.csvEmpty"),
          description: t("pt.csvEmptyDesc"),
          variant: "destructive",
        });
        return;
      }
      setTags(imported);
      setActiveId(imported[0].id);
      toast({
        title: t("pt.imported", { n: imported.length }),
        description: t("pt.importedDesc"),
      });
    },
    [toast, t]
  );

  /** Экспорт текущего списка товаров в CSV (только UI-данные) */
  const exportCsv = useCallback(() => {
    if (!tags.length) return;
    const esc = (s: string) =>
      /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const header = [
      t("pt.csvHead.name"),
      t("pt.csvHead.price"),
      t("pt.csvHead.old"),
      t("pt.csvHead.qr"),
      t("pt.csvHead.barcode"),
      t("pt.csvHead.sku"),
      t("pt.csvHead.lines"),
    ];
    const rows = tags.map((t) =>
      [
        t.name,
        t.price,
        t.oldPrice,
        t.qr,
        t.barcode,
        t.sku,
        t.extraLines.filter((l) => l.trim()).join("|"),
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
    toast({ title: t("pt.csvSaved"), description: t("pt.csvSavedDesc", { n: tags.length }) });
  }, [tags, toast, t]);

  /** Вставка из Excel: разобрать таблицу и ДОБАВИТЬ товары к списку */
  const pasteFromTable = useCallback(() => {
    const parsed = importPricetagsFromTable(pasteText);
    if (!parsed.length) {
      toast({
        title: t("pt.tableFailed"),
        description: t("pt.tableFailedDesc"),
        variant: "destructive",
      });
      return;
    }
    setTags((prev) => [...prev, ...parsed]);
    setActiveId(parsed[0].id);
    setShowPaste(false);
    setPasteText("");
    toast({
      title: t("pt.addedN", { n: parsed.length }),
      description: t("pt.addedDesc"),
    });
  }, [pasteText, toast, t]);

  const handlePrint = useCallback(async () => {
    // - Не-BLE транспорта: POS-USB (ESC/POS, usb-printer-context) и HPRT
    //   (v1.0.55, BT-этикетки через hprt-printer-context) — ветка не зависит
    //   от Web Bluetooth и его отсутствия -
    if (transport !== "ble") {
      if (!tags.length) {
        toast({ title: t("pt.listEmpty"), variant: "destructive" });
        return;
      }
      setPrinting(true);
      try {
        const canvas = document.createElement("canvas");
        renderPricetagTapeToCanvas(canvas, tags, style, { minHeightPx });
        const combined = renderCopies(canvas, copies);
        await (transport === "usb" ? printUsb : printHprt)(combined);
        notePrintedMm(combined.height / PX_PER_MM);
        const noun = plural(lang, tags.length, [t("pt.nounOne"), t("pt.nounFew"), t("pt.nounMany")], [t("pt.nounOne"), t("pt.nounMany")]);
        setBanner(t("pt.bannerTape", { n: tags.length, noun }));
        setTimeout(() => setBanner(null), 4000);
      } catch (e) {
        toast({
          title: t("common.printError"),
          description: (e as Error)?.message ?? t("pt.printFailed"),
          variant: "destructive",
        });
      } finally {
        setPrinting(false);
      }
      return;
    }
    if (status === "unsupported") {
      // Браузер без Web Bluetooth — шапка показывает предупреждение
      window.dispatchEvent(new CustomEvent("mxw01:ble-warning"));
      return;
    }
    if (!tags.length) {
      toast({ title: t("pt.listEmpty"), variant: "destructive" });
      return;
    }
    setPrinting(true);
    try {
      if (status !== "connected") {
        toast({ title: t("common.connecting") });
        await connect();
      }
      const canvas = document.createElement("canvas");
      renderPricetagTapeToCanvas(canvas, tags, style, { minHeightPx });
      // Копии набора собираются в одну ленту — одно задание печати, без
      // пропусков бумаги (драйвер не изменён)
      const combined = renderCopies(canvas, copies);
      await printCanvas(combined);
      notePrintedMm(combined.height / PX_PER_MM);
      const noun = plural(lang, tags.length, [t("pt.nounOne"), t("pt.nounFew"), t("pt.nounMany")], [t("pt.nounOne"), t("pt.nounMany")]);
      setBanner(t("pt.bannerTape", { n: tags.length, noun }));
      setTimeout(() => setBanner(null), 4000);
    } catch (e) {
      toast({
        title: t("common.printError"),
        description: (e as Error)?.message ?? t("pt.printFailed"),
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }, [connect, printCanvas, copies, status, tags, style, minHeightPx, toast, t, lang, transport, printUsb, printHprt]);

  const activeIndex = tags.findIndex((t) => t.id === activeId);

  /** Физическая ширина рендера при текущем масштабе (384 px = X мм бумаги) */
  const renderWidthMm = (PRINTER_HEAD_WIDTH / style.dpi) * 25.4;
  /** Масштаб соответствует ленте 55 мм (нативное разрешение) */
  const isNativeTape = Math.abs(renderWidthMm - TAPE_WIDTH_MM) < 0.5;

  return (
    <Workspace>
      {/* ------------------------- Левая панель ------------------------- */}
      <LeftPanel>
        <div className="space-y-4 p-4">
          {/* Товары */}
          <SectionHeader
            icon={<Package className="h-4 w-4 shrink-0 text-slate-400" />}
            title={t("pt.goods")}
            badge={tags.length}
            actions={
              <>
                <IconBtn title={t("pt.exportCsv")} onClick={exportCsv} disabled={!tags.length}>
                  <Download className="h-4 w-4" />
                </IconBtn>
                <IconBtn
                  title={t("pt.importCsv")}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                </IconBtn>
                <IconBtn
                  title={t("pt.paste")}
                  onClick={() => setShowPaste((v) => !v)}
                  active={showPaste}
                >
                  <ClipboardPaste className="h-4 w-4" />
                </IconBtn>
                <IconBtn
                  title={t("pt.duplicateCurrent")}
                  onClick={duplicateTag}
                  disabled={!active}
                >
                  <Copy className="h-4 w-4" />
                </IconBtn>
                <IconBtn title={t("pt.newProduct")} onClick={addTag}>
                  <Plus className="h-4 w-4" />
                </IconBtn>
              </>
            }
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCsv(f);
              e.target.value = "";
            }}
          />

          {/* Вставка из Excel / Google Sheets */}
          {showPaste && (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t("pt.pasteHint")}
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                aria-label={t("pt.pasteAria")}
                placeholder={t("pt.pastePlaceholder")}
                rows={5}
                className={cn(FLAT_INPUT, "h-auto resize-y py-2 font-mono text-xs")}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">
                  {pasteText.trim()
                    ? t("pt.recognized", { n: importPricetagsFromTable(pasteText).length })
                    : t("pt.pasteEmpty")}
                </span>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md px-2.5 text-xs font-medium"
                    onClick={() => {
                      setShowPaste(false);
                      setPasteText("");
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                    onClick={pasteFromTable}
                    disabled={!pasteText.trim()}
                  >
                    {t("common.add")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Чипы товаров */}
          {tags.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-muted-foreground dark:border-slate-700">
              {t("pt.noProducts")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag, i) => {
                const isActive = tag.id === activeId;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setActiveId(tag.id)}
                    title={t("pt.productN", { n: i + 1 })}
                    className={cn(
                      "inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    )}
                  >
                    <span className="max-w-[160px] truncate">
                      {tag.name.trim() || t("pt.productN", { n: i + 1 })}
                    </span>
                    {tag.price.trim() && (
                      <span
                        className={cn(
                          "text-[10px] font-semibold",
                          isActive
                            ? "text-white/70 dark:text-slate-900/60"
                            : "text-slate-400"
                        )}
                      >
                        {tag.price}₽
                      </span>
                    )}
                    <X
                      className="h-3 w-3 shrink-0 opacity-40 transition-opacity hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTag(tag.id);
                      }}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* Поля активного товара */}
          {active && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={active.name}
                  placeholder={t("pt.namePlaceholder")}
                  aria-label={t("pt.nameAria")}
                  onChange={(e) => updateActive({ name: e.target.value })}
                  className={FLAT_INPUT}
                />
                <input
                  value={active.price}
                  placeholder="999"
                  inputMode="decimal"
                  aria-label={t("pt.priceAria")}
                  onChange={(e) => updateActive({ price: e.target.value })}
                  className={cn(FLAT_INPUT, "w-[110px] shrink-0")}
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={active.oldPrice}
                  placeholder={t("pt.oldPricePlaceholder")}
                  inputMode="decimal"
                  aria-label={t("pt.oldPriceAria")}
                  onChange={(e) => updateActive({ oldPrice: e.target.value })}
                  className={cn(FLAT_INPUT, "w-[110px] shrink-0")}
                />
                <input
                  value={active.sku}
                  placeholder={t("pt.skuPlaceholder")}
                  aria-label={t("pt.skuAria")}
                  onChange={(e) => updateActive({ sku: e.target.value })}
                  className={FLAT_INPUT}
                />
              </div>
              <input
                value={active.qr}
                placeholder={t("pt.qrPlaceholder")}
                aria-label={t("pt.qrAria")}
                onChange={(e) => updateActive({ qr: e.target.value })}
                className={FLAT_INPUT}
              />
              <input
                value={active.barcode}
                placeholder={t("pt.barcodePlaceholder")}
                aria-label={t("pt.barcodeAria")}
                inputMode="text"
                onChange={(e) => updateActive({ barcode: e.target.value })}
                className={FLAT_INPUT}
              />
            </div>
          )}

          {/* Строки ценника */}
          {active && (
            <CollapsibleSection
              icon={<Type className="h-4 w-4 shrink-0 text-slate-400" />}
              title={t("pt.linesTitle")}
              open={linesOpen}
              onToggle={() => setLinesOpen((v) => !v)}
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 rounded-md px-2.5 text-xs font-medium"
                    onClick={() =>
                      updateActive({ extraLines: [...active.extraLines, ""] })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> {t("common.add")}
                  </Button>
                  <IconBtn
                    title={t("pt.deleteLastLine")}
                    danger
                    disabled={active.extraLines.length === 0}
                    onClick={() =>
                      updateActive({
                        extraLines: active.extraLines.slice(0, -1),
                      })
                    }
                  >
                    <Minus className="h-4 w-4" />
                  </IconBtn>
                </>
              }
            >
              <div className="space-y-1.5">
                {active.extraLines.length === 0 && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    {t("pt.noLines")}
                  </p>
                )}
                {active.extraLines.map((line, i) => (
                  <div
                    key={i}
                    ref={(el) => {
                      if (el) lineRowsRef.current.set(i, el);
                      else lineRowsRef.current.delete(i);
                    }}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border p-1.5 transition-colors",
                      dragLineIndex === i
                        ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800"
                        : "border-slate-200 dark:border-slate-700"
                    )}
                  >
                    <span
                      onPointerDown={(e) => beginLineDrag(e, i)}
                      onPointerMove={moveLineDrag}
                      onPointerUp={endLineDrag}
                      onPointerCancel={endLineDrag}
                      title={t("pt.dragOrder")}
                      className={cn(
                        "flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-slate-300 transition-colors hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300",
                        dragLineIndex === i &&
                          "cursor-grabbing text-slate-700 dark:text-slate-200"
                      )}
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {i + 1}
                    </span>
                    <input
                      value={line}
                      placeholder={t("pt.linePlaceholder", { n: i + 1 })}
                      aria-label={t("pt.lineAria", { n: i + 1 })}
                      onFocus={() => {
                        lastLineFocusRef.current = i;
                      }}
                      onChange={(e) => {
                        const next = [...active.extraLines];
                        next[i] = e.target.value;
                        updateActive({ extraLines: next });
                      }}
                      className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-300 hover:border-slate-200 focus:border-slate-900 focus:bg-white dark:text-slate-100 dark:placeholder:text-slate-600 dark:hover:border-slate-700 dark:focus:border-slate-100 dark:focus:bg-slate-900"
                    />
                    <IconBtn
                      title={t("pt.deleteLine")}
                      danger
                      onClick={() =>
                        updateActive({
                          extraLines: active.extraLines.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                ))}

                {/* Подстановки данных товара */}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <span className="text-[11px] text-slate-400">{t("pt.insert")}</span>
                  {PLACEHOLDER_CHIPS.map((c) => (
                    <button
                      key={c.ph}
                      type="button"
                      title={t("pt.chipTitle", { label: t(c.labelKey) })}
                      onClick={() => insertPlaceholder(c.ph)}
                      className="h-6 rounded-md border border-slate-200 bg-white px-1.5 font-mono text-[11px] text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-100 dark:hover:text-slate-100"
                    >
                      {c.ph}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {t("pt.linesHint")}
                </p>
              </div>
            </CollapsibleSection>
          )}

          {/* Типография и печать */}
          <CollapsibleSection
            icon={<SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-400" />}
            title={t("pt.typeTitle")}
            open={typeOpen}
            onToggle={() => setTypeOpen((v) => !v)}
          >
            <div className="space-y-5">
              {/* Границы */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("pt.borders")}</span>
                <Switch
                  id="borders"
                  checked={style.borders}
                  onCheckedChange={(v) => setStyle((s) => ({ ...s, borders: v }))}
                />
              </div>

              {/* Размеры */}
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    { key: "nameSize", label: t("pt.size.name"), min: 20, max: 60 },
                    { key: "priceSize", label: t("pt.size.price"), min: 30, max: 72 },
                    { key: "extraSize", label: t("pt.size.extra"), min: 14, max: 32 },
                    { key: "oldPriceSize", label: t("pt.size.old"), min: 16, max: 36 },
                  ] as const
                ).map((row) => (
                  <div key={row.key} className="space-y-1.5">
                    <Label className="text-xs">
                      {row.label} <span className="font-normal">{style[row.key]}px</span>
                    </Label>
                    <Slider
                      min={row.min}
                      max={row.max}
                      step={1}
                      value={[style[row.key]]}
                      onValueChange={([v]) => setStyle((s) => ({ ...s, [row.key]: v }))}
                    />
                  </div>
                ))}
              </div>

              {/* Шрифт и жирность */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("pt.font")}</Label>
                  <select
                    value={style.fontFamily}
                    onChange={(e) => setStyle((s) => ({ ...s, fontFamily: e.target.value }))}
                    aria-label={t("pt.fontAria")}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-xs outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("pt.weight")}</Label>
                  <div className="flex gap-1.5">
                    <Button
                      variant={style.nameBold ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "h-9 flex-1 text-xs",
                        style.nameBold &&
                          "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                      )}
                      onClick={() => setStyle((s) => ({ ...s, nameBold: !s.nameBold }))}
                    >
                      {t("pt.size.name")}
                    </Button>
                    <Button
                      variant={style.priceBold ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "h-9 flex-1 text-xs",
                        style.priceBold &&
                          "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                      )}
                      onClick={() => setStyle((s) => ({ ...s, priceBold: !s.priceBold }))}
                    >
                      {t("pt.size.price")}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Выравнивание */}
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    { key: "nameAlign", label: t("pt.size.name") },
                    { key: "priceAlign", label: t("pt.size.price") },
                    { key: "extraAlign", label: t("pt.size.extra") },
                  ] as const
                ).map((row) => (
                  <div key={row.key} className="space-y-1.5">
                    <Label className="text-xs">{row.label}</Label>
                    <AlignGroup
                      t={t}
                      value={style[row.key]}
                      onChange={(v: TextAlignment) =>
                        setStyle((s) => ({ ...s, [row.key]: v }))
                      }
                    />
                  </div>
                ))}
              </div>

              {/* Масштаб печати — якорь: лента 55 мм (нативное разрешение) */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">
                    {t("pt.printScale")}{" "}
                    <span className="font-normal">
                      {(style.dpi / TAPE_DPI).toFixed(2)}x
                    </span>
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-slate-400"
                    onClick={() => setStyle((s) => ({ ...s, dpi: TAPE_DPI }))}
                  >
                    {t("pt.tapeBtn")}
                  </Button>
                </div>
                <Slider
                  min={96}
                  max={600}
                  step={1}
                  value={[style.dpi]}
                  onValueChange={([v]) => setStyle((s) => ({ ...s, dpi: v }))}
                />
                <div className="grid grid-cols-3 gap-1.5">
                  {DPI_PRESETS.map((p) => (
                    <button
                      key={p.dpi}
                      type="button"
                      title={`${p.dpi} DPI — ${t(p.labelKey)}`}
                      onClick={() => setStyle((s) => ({ ...s, dpi: p.dpi }))}
                      className={cn(
                        "flex h-auto flex-col items-center rounded-md border px-1 py-1.5 transition-colors",
                        style.dpi === p.dpi
                          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      )}
                    >
                      <span className="text-xs font-bold">{p.dpi}</span>
                      <span className="text-[9px] leading-tight">{t(p.labelKey)}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-100 p-2.5 text-xs text-muted-foreground dark:bg-slate-800">
                  <span>
                    {t("pt.renderWidth")} <b>{renderWidthMm.toFixed(1)}мм</b>
                    {isNativeTape
                      ? t("pt.exactTape")
                      : t("pt.tapeAt", { dpi: TAPE_DPI })}
                  </span>
                  <span>
                    {t("pt.qualityLabel")} <b>{t("pt.qualityValue")}</b>
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("pt.scaleHint", { dpi: TAPE_DPI })}
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* Копии */}
          <CopiesControl
            t={t}
            settings={copies}
            onChange={(patch) => setCopies((prev) => ({ ...prev, ...patch }))}
          />

          {/* Высота этикетки (длина ленты) — общий контрол со вкладками */}
          <LabelSizeControl t={t} />

          {/* Мои шаблоны */}
          <CollapsibleSection
            icon={<Bookmark className="h-4 w-4 shrink-0 text-slate-400" />}
            title={t("pt.templates")}
            badge={userTpls.length || undefined}
            open={myTplsOpen}
            onToggle={() => setMyTplsOpen((v) => !v)}
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={tplLabel}
                  onChange={(e) => setTplLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTpl();
                  }}
                  placeholder={t("pt.tplPlaceholder")}
                  aria-label={t("pt.tplAria")}
                  className={FLAT_INPUT}
                />
                <button
                  type="button"
                  title={t("pt.saveTpl")}
                  disabled={!active}
                  onClick={saveTpl}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  <BookmarkPlus className="h-4 w-4" />
                  {t("common.save")}
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                {t("pt.tplHint")}
              </p>
              {userTpls.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400 dark:border-slate-700">
                  {t("pt.tplEmpty")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {userTpls.map((tpl) => (
                    <span
                      key={tpl.id}
                      className="group inline-flex h-8 items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-xs shadow-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      <button
                        type="button"
                        title={t("pt.applyTpl", { label: tpl.label })}
                        onClick={() => applyTplNow(tpl)}
                        className="inline-flex h-full items-center gap-1.5 px-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <BookmarkPlus className="h-3.5 w-3.5 text-slate-400" />
                        {tpl.label}
                      </button>
                      <button
                        type="button"
                        title={t("pt.deleteTpl", { label: tpl.label })}
                        aria-label={t("pt.deleteTplAria", { label: tpl.label })}
                        onClick={() => deleteTpl(tpl.id)}
                        className="inline-flex h-full items-center border-l border-slate-200 px-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleSection>
        </div>
      </LeftPanel>

      {/* ------------------------ Правая панель ------------------------- */}
      <RightPanel>
        <PreviewHeader
          t={t}
          actions={
            <>
              <Pill>{t("pt.tapeBtn")}</Pill>
              <Pill>
                {minHeightPx
                  ? t("tt.pillHeight", { mm: labelSize.heightMm, px: minHeightPx })
                  : "384px · 1:1"}
              </Pill>
              <Pill>{t("pt.pillCount", { n: tags.length })}</Pill>
            </>
          }
        />
        <PreviewBody>
          {banner && <FlatBanner text={banner} />}
          <div className="mx-auto w-full max-w-[560px] space-y-3 px-4 pt-6">
            {tags.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-muted-foreground dark:border-slate-700">
                {t("pt.previewEmpty")}
              </p>
            )}
            {tags.map((tag, i) => (
              <div
                key={tag.id}
                className={cn(
                  "cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition-colors dark:bg-slate-900",
                  tag.id === activeId
                    ? "border-slate-900 dark:border-slate-100"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                )}
                onClick={() => setActiveId(tag.id)}
              >
                <div className="mb-2 text-xs font-semibold text-slate-400">
                  #{i + 1} {tag.name || t("pt.untitled")}
                </div>
                <div className="flex justify-center">
                  <canvas
                    ref={(el) => {
                      if (el) {
                        previewsRef.current.set(tag.id, el);
                        renderPricetagToCanvas(el, tag, style, { minHeightPx });
                      } else {
                        previewsRef.current.delete(tag.id);
                      }
                    }}
                    className="max-w-full rounded border bg-white"
                    style={{ imageRendering: "pixelated", width: 384 }}
                  />
                </div>
              </div>
            ))}
            <ScaleCaption text={t("pt.previewCaption")} />
            {/* Скрытая лента для печати */}
            <canvas ref={tapeCanvasRef} className="hidden" />
          </div>
        </PreviewBody>
        <PrintDock
          t={t}
          onClick={handlePrint}
          disabled={!tags.length}
          loading={printing || status === "printing"}
          label={
            printing || status === "printing"
              ? t("common.printing")
              : tags.length
                ? `${t("common.print")} (${tags.length})`
                : t("common.print")
          }
        />
      </RightPanel>
    </Workspace>
  );
}
