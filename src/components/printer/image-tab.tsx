"use client";
/**
 * Вкладка «Изображение» — загрузка картинки, тон-редактор и печать.
 *
 * Обработка выполняется на стороне приложения (image-processing.ts):
 *   • гамма-яркость −100…+100 — чёрный и белый не сдвигаются, фон не грязнится;
 *   • контраст, резкость;
 *   • «Авто» — тон по гистограмме одной кнопкой;
 *   • дизеринг — точные копии алгоритмов драйвера;
 * результат — СТРОГО бинарный холст: печать printCanvas(canvas) без параметров
 * даёт на бумаге ровно то, что видно в предпросмотре (печать = превью).
 *
 * Копии собираются в одну ленту (copies.ts) и печатаются одним заданием.
 * Драйвер `mxw01-thermal-printer` не изменён.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { usePrinter } from "@/lib/printer/printer-context";
import { useUsbPrinter } from "@/lib/printer/usb/usb-printer-context";
import { useHprtPrinter } from "@/lib/printer/hprt/hprt-printer-context";
import {
  applyImageSettings,
  autoTone,
  drawScaledToCanvas,
  scaleCanvasToWidth,
  toGray,
} from "@/lib/printer/image-processing";
import type { ImageDither } from "@/lib/printer/image-processing";
import { renderCopies } from "@/lib/printer/copies";
import type { CopiesSettings } from "@/lib/printer/copies";
import { DEFAULT_COPIES } from "@/lib/printer/copies";
import { PX_PER_MM } from "@/lib/printer/types";
import { notePrintedMm } from "@/lib/printer/tape-counter";
import {
  Workspace,
  LeftPanel,
  RightPanel,
  PreviewHeader,
  PreviewBody,
  PrintDock,
  ScaleCaption,
  SectionHeader,
  Pill,
  CopiesControl,
  IconBtn,
} from "./shell";
import { Image as ImageIcon, ImagePlus, Sparkles, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/printer/i18n";
import type { Lang, Translator } from "@/lib/printer/i18n";

const TAPE_WIDTH = 384;

/** Диапазон масштаба картинки, % от ширины печати (v1.0.44) */
const SCALE_MIN = 20;
const SCALE_MAX = 100;
const SCALE_STEP = 5;

const DITHER_OPTIONS: { value: ImageDither; labelKey: string }[] = [
  { value: "steinberg", labelKey: "it.dither.steinberg" },
  { value: "bayer", labelKey: "it.dither.bayer" },
  { value: "atkinson", labelKey: "it.dither.atkinson" },
  { value: "none", labelKey: "it.dither.none" },
];

export function ImageTab({ t, lang }: { t: Translator; lang: Lang }) {
  const { status, printCanvas, connect } = usePrinter();
  const { transport, printCanvas: printUsb } = useUsbPrinter();
  const { printCanvas: printHprt } = useHprtPrinter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  /** Исходник после даунскейла к ширине ленты (вне DOM) */
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  /** Видимый холст предпросмотра = точное содержимое печати */
  const previewRef = useRef<HTMLCanvasElement>(null);

  const [hasImage, setHasImage] = useState(false);
  const [fileName, setFileName] = useState("");
  const [imgVersion, setImgVersion] = useState(0);
  const [printing, setPrinting] = useState(false);

  // Тон-редактор
  const [dither, setDither] = useState<ImageDither>("steinberg");
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [sharpen, setSharpen] = useState(0);

  // Масштаб (v1.0.44): ширина картинки в % от ширины печати. 100% — картинка
  // на всю ширину (мелкие исходники растягиваются — поля слева/справа
  // минимальные), ниже — уже и по центру ленты (renderCopies центрирует)
  const [scale, setScale] = useState(100);

  // Копии
  const [copies, setCopies] = useState<CopiesSettings>(DEFAULT_COPIES);

  // «В ряд» доступен, только если контент уже ленты: ширина контента =
  // TAPE_WIDTH · scale/100 (исходник всегда масштабируется к этой ширине)
  const rowAvailable = hasImage && scale < SCALE_MAX;

  const loadImage = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        // Прогрессивный даунскейл к ширине ленты; мелкие картинки не растягиваются
        sourceRef.current = drawScaledToCanvas(img, TAPE_WIDTH);
        setHasImage(true);
        setFileName(file.name);
        setImgVersion((v) => v + 1);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast({ title: t("it.openFailed"), variant: "destructive" });
    };
    img.src = url;
  }, [toast, t]);

  // Предпросмотр = точный результат печати (тот же пайплайн + копии)
  useEffect(() => {
    const source = sourceRef.current;
    const preview = previewRef.current;
    if (!hasImage || !source || !preview) return;
    // v1.0.44: масштаб ДО тона/дизеринга — дизеринг выполняется на финальном
    // размере (качество), мелкие исходники на 100% растягиваются на всю
    // ширину печати — белые поля слева/справа исчезают
    const contentW = Math.max(1, Math.round((TAPE_WIDTH * scale) / 100));
    const scaled = scaleCanvasToWidth(source, contentW);
    const processed = document.createElement("canvas");
    applyImageSettings(scaled, processed, { dither, brightness, contrast, sharpen });
    const combined = renderCopies(processed, copies);
    preview.width = combined.width;
    preview.height = combined.height;
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(combined, 0, 0);
  }, [hasImage, imgVersion, dither, brightness, contrast, sharpen, copies, scale]);

  /** «Авто»: тон по гистограмме исходника — подставляется в слайдеры */
  const handleAuto = useCallback(() => {
    const source = sourceRef.current;
    if (!source || !hasImage) return;
    const ctx = source.getContext("2d");
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, source.width, source.height);
    const tone = autoTone(toGray(img.data));
    setBrightness(tone.brightness);
    setContrast(tone.contrast);
    toast({
      title: t("it.autoDone"),
      description:
        tone.brightness === 0 && tone.contrast === 0
          ? t("it.autoAlready")
          : t("it.autoDesc", { b: `${tone.brightness > 0 ? "+" : ""}${tone.brightness}`, c: tone.contrast }),
    });
  }, [hasImage, toast, t]);

  /** Сброс тона к нейтральному */
  const handleReset = useCallback(() => {
    setBrightness(0);
    setContrast(0);
    setSharpen(0);
  }, []);

  const handlePrint = useCallback(async () => {
    // - Не-BLE транспорта: POS-USB (ESC/POS, usb-printer-context) и HPRT
    //   (v1.0.55, BT-этикетки через hprt-printer-context) — ветка не зависит
    //   от Web Bluetooth и его отсутствия -
    if (transport !== "ble") {
      const usbPreview = previewRef.current;
      if (!usbPreview || !hasImage) return;
      setPrinting(true);
      try {
        await (transport === "usb" ? printUsb : printHprt)(usbPreview);
        notePrintedMm(usbPreview.height / PX_PER_MM);
        toast({ title: t("it.printSent") });
      } catch (e) {
        toast({
          title: t("common.printError"),
          description: (e as Error)?.message ?? t("it.printFailed"),
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
    const preview = previewRef.current;
    if (!preview || !hasImage) return;
    setPrinting(true);
    try {
      if (status !== "connected") {
        toast({ title: t("common.connecting") });
        await connect();
      }
      // Печать = превью: холст строго ч/б, параметры драйвера по умолчанию
      await printCanvas(preview);
      notePrintedMm(preview.height / PX_PER_MM);
      toast({ title: t("it.printSent") });
    } catch (e) {
      toast({
        title: t("common.printError"),
        description: (e as Error)?.message ?? t("it.printFailed"),
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }, [connect, hasImage, printCanvas, status, toast, t, transport, printUsb, printHprt]);

  return (
    <Workspace>
      {/* ------------------------- Левая панель ------------------------- */}
      <LeftPanel>
        <div className="space-y-4 p-4">
          <SectionHeader
            icon={<ImageIcon className="h-4 w-4 shrink-0 text-slate-400" />}
            title={t("it.section")}
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadImage(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-slate-400 transition-colors",
              "border-slate-300 hover:border-slate-900 hover:text-slate-700",
              "dark:border-slate-700 dark:hover:border-slate-100 dark:hover:text-slate-200"
            )}
          >
            <ImagePlus className="h-8 w-8" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {fileName ? fileName : t("it.choose")}
            </span>
            <span className="text-xs text-slate-400">
              {t("it.formats")}
            </span>
          </button>

          {/* Тон и качество */}
          <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t("it.toneTitle")}
              </span>
              <div className="flex items-center gap-1">
                <IconBtn
                  title={t("it.autoTitle")}
                  disabled={!hasImage}
                  onClick={handleAuto}
                  className="text-slate-500"
                >
                  <Sparkles className="h-4 w-4" />
                </IconBtn>
                <IconBtn
                  title={t("it.resetTitle")}
                  disabled={!hasImage || (brightness === 0 && contrast === 0 && sharpen === 0)}
                  onClick={handleReset}
                >
                  <Undo2 className="h-4 w-4" />
                </IconBtn>
                <span className="w-14 text-right text-[11px] text-slate-400">{t("it.autoReset")}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>
                {t("it.brightness")} <span className="font-normal">{brightness > 0 ? `+${brightness}` : brightness}</span>
              </Label>
              <Slider
                min={-100}
                max={100}
                step={1}
                disabled={!hasImage}
                value={[brightness]}
                onValueChange={([v]) => setBrightness(v)}
              />
              <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                {t("it.brightnessHint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>
                {t("it.contrast")} <span className="font-normal">{contrast > 0 ? `+${contrast}` : contrast}</span>
              </Label>
              <Slider
                min={-100}
                max={100}
                step={1}
                disabled={!hasImage}
                value={[contrast]}
                onValueChange={([v]) => setContrast(v)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                {t("it.sharpen")} <span className="font-normal">{sharpen}</span>
              </Label>
              <Slider
                min={0}
                max={100}
                step={1}
                disabled={!hasImage}
                value={[sharpen]}
                onValueChange={([v]) => setSharpen(v)}
              />
              <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                {t("it.sharpenHint")}
              </p>
            </div>
          </div>

          {/* Масштаб (v1.0.44) */}
          <div className="space-y-1.5">
            <Label>
              {t("it.scale")} <span className="font-normal">{scale}%</span>
            </Label>
            <Slider
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={SCALE_STEP}
              disabled={!hasImage}
              value={[scale]}
              onValueChange={([v]) => setScale(v)}
            />
            <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              {t("it.scaleHint")}
            </p>
          </div>

          {/* Дизеринг */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("it.dither")}</Label>
            <select
              value={dither}
              onChange={(e) => setDither(e.target.value as ImageDither)}
              aria-label={t("it.dither")}
              disabled={!hasImage}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-xs outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {DITHER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              {dither === "none" ? t("it.ditherHintNone") : t("it.ditherHintDither")}
            </p>
          </div>

          {/* Копии */}
          <CopiesControl
            t={t}
            settings={copies}
            onChange={(patch) => setCopies((prev) => ({ ...prev, ...patch }))}
            rowAvailable={rowAvailable}
          />

          <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">
            {t("it.previewHint")}
          </p>
        </div>
      </LeftPanel>

      {/* ------------------------ Правая панель ------------------------- */}
      <RightPanel>
        <PreviewHeader
          t={t}
          actions={
            <>
              <Pill>384px · {t("pt.tapeBtn")}</Pill>
              <Pill>
                {hasImage
                  ? `${previewRef.current?.width ?? TAPE_WIDTH}×${previewRef.current?.height ?? 0}`
                  : t("it.pillEmpty")}
              </Pill>
              {hasImage && scale < SCALE_MAX && <Pill>{scale}%</Pill>}
              {copies.copies > 1 && (
                <Pill>
                  {copies.copies}{" "}
                  {plural(lang, copies.copies, ["копия", "копии", "копий"], ["copy", "copies"])}
                </Pill>
              )}
            </>
          }
        />
        <PreviewBody>
          <div className="mx-auto w-full max-w-[560px] px-4 pt-6">
            <div className="flex min-h-48 items-center justify-center">
              {hasImage ? (
                <canvas
                  ref={previewRef}
                  className="max-w-full rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5"
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/60">
                  {t("it.noImage")}
                </div>
              )}
            </div>
            <ScaleCaption text={t("it.caption")} />
          </div>
        </PreviewBody>
        <PrintDock
          t={t}
          onClick={handlePrint}
          disabled={!hasImage}
          loading={printing || status === "printing"}
          label={printing || status === "printing" ? t("common.printing") : t("common.print")}
        />
      </RightPanel>
    </Workspace>
  );
}
