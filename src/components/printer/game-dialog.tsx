"use client";
/**
 * ============================================================================
 *  СЕКРЕТНАЯ МИНИ-ИГРА «РАННЕР» (v1.0.53).
 * ============================================================================
 *  Открывается 5 кликами/тапами по номеру версии в Настройках (app-header).
 *  Механика — как у динозаврика Chrome: персонаж бежит сам, игрок прыгает
 *  через препятствия (рулоны ленты РАЗНОЙ высоты), собирает монетки (+5 к
 *  счёту), скорость растёт, счёт = дистанция + монеты. Один вход на всё:
 *  тап / клик / пробел / стрелка вверх.
 *
 *  Высоты рулонов (v1.0.53): низкие 16–22, средние 26–34, высокие 44–54 —
 *  высокие перепрыгиваются с запасом (максимум прыжка ≈ 133 лог. px).
 *  Первые три спавна фиксированы (средний → низкий → высокий) — мягкий
 *  онбординг; дальше — случайные с весами. Двойные кластеры — только из
 *  низких/средних.
 *
 *  Монетки (v1.0.53): янтарный кружок с «прорезью», крутится (сплющивание
 *  по X). Спавн: над кластером (45%) или дуга из трёх в промежутке (20%),
 *  перед первым рулоном — гарантированная низкая на разбеге (собираешь
 *  с земли ещё до первого прыжка).
 *  Сбор: AABB-пересечение с игроком → +5 к счёту, всплывающее «+5».
 *
 *  Почему это удобно на обоих устройствах:
 *   • телефон — тап по любой точке игрового поля (touch-action: none,
 *     страница не скроллится);
 *   • ПК — клик мышью либо пробел/↑ на клавиатуре (пока открыт диалог).
 *
 *  Технические детали:
 *   • логическое поле 560×220, масштабируется по ширине диалога, HiDPI
 *     (canvas.width = css × devicePixelRatio); вся физика — в логических
 *     единицах, геймплей одинаков на телефоне и ПК;
 *   • тёмная тема читается с <html> каждый кадр (дёшево);
 *   • рекорд хранится в localStorage (mxw01-runner-best);
 *   • рестарт после проигрыша — с задержкой 500 мс, чтобы случайный тап
 *     не пропустил экран «Игра окончена»;
 *   • случайный тап по кнопкам (рестарт) не прыгает — pointerdown
 *     игнорирует события с e.target внутри <button>.
 * ============================================================================
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, Trophy } from "lucide-react";
import type { Translator } from "@/lib/printer/i18n";

/* --- логическое поле и физика --- */
const W = 560;
const H = 220;
const GROUND_Y = H - 34;
const PLAYER_X = 48;
const PLAYER_W = 34;
const PLAYER_H = 32;
const GRAVITY = 2400;
const JUMP_V = -800;
const SPEED_START = 270;
const SPEED_MAX = 640;
const SPEED_GAIN = 11; // px/s прибавки за каждую секунду забега
const BEST_KEY = "mxw01-runner-best";
const RESTART_GUARD_MS = 500;
const COIN_R = 7; /* радиус монетки, лог. px */
const COIN_SCORE = 5; /* сколько очков даёт монетка */

type Phase = "ready" | "playing" | "over";

interface Obstacle {
  x: number;
  w: number;
  h: number;
}

interface Coin {
  x: number; /* центр, лог. px */
  y: number; /* центр, лог. px */
  spin: number; /* фаза вращения */
}

/** Всплывающая «+5» на месте собранной монетки */
interface Particle {
  x: number;
  y: number;
  t: number; /* возраст, с */
}

/** Скруглённый прямоугольник на холсте (персонаж и рулоны) */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function GameDialog({
  t,
  open,
  onOpenChange,
}: {
  /** Переводчик — через пропсы (словари в src/locales) */
  t: Translator;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  /* Фактическая монтированность игрового поля: Radix монтирует содержимое
     диалога порталом — эффект цикла запускаем только после появления DOM */
  const [gameReady, setGameReady] = useState(false);
  const setWrapRef = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el;
    setGameReady(!!el);
  }, []);

  /* Состояние игры — в ref (истина для rAF), в React — только фазы и финал */
  const phaseRef = useRef<Phase>("ready");
  const [phase, setPhase] = useState<Phase>("ready");
  const [finalScore, setFinalScore] = useState(0);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);

  const yRef = useRef(GROUND_Y);
  const vyRef = useRef(0);
  const distRef = useRef(0);
  const timeRef = useRef(0);
  const speedRef = useRef(SPEED_START);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const spawnAtRef = useRef(0);
  const overAtRef = useRef(0);
  const coinsRef = useRef<Coin[]>([]);
  const partsRef = useRef<Particle[]>([]);
  const coinsCountRef = useRef(0);
  const spawnCountRef = useRef(0);
  const [finalCoins, setFinalCoins] = useState(0);

  /* Сброс мира в исходное */
  const resetWorld = useCallback(() => {
    yRef.current = GROUND_Y;
    vyRef.current = 0;
    distRef.current = 0;
    timeRef.current = 0;
    speedRef.current = SPEED_START;
    obstaclesRef.current = [];
    spawnAtRef.current = 320;
    coinsRef.current = [];
    partsRef.current = [];
    coinsCountRef.current = 0;
    spawnCountRef.current = 0;
  }, []);

  /* Смена фазы: ref для цикла + React для оверлеев */
  const goPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /* Старт/перезапуск забега */
  const startRun = useCallback(() => {
    resetWorld();
    goPhase("playing");
  }, [resetWorld, goPhase]);

  /* Вход «прыжок» (он же старт и рестарт — один вход на всё) */
  const inputAction = useCallback(() => {
    const p = phaseRef.current;
    if (p === "ready") {
      startRun();
      vyRef.current = JUMP_V;
      return;
    }
    if (p === "playing") {
      if (yRef.current >= GROUND_Y - 0.5) vyRef.current = JUMP_V;
      return;
    }
    /* over: рестарт только после паузы, чтобы случайный тап не пропустил экран */
    if (Date.now() - overAtRef.current > RESTART_GUARD_MS) {
      startRun();
      vyRef.current = JUMP_V;
    }
  }, [startRun, goPhase]);

  /* Клавиатура: пока диалог открыт, пробел/↑ — это игра (глушим скролл и кнопки) */
  useEffect(() => {
    if (!open) return;
    const codes = new Set(["Space", "ArrowUp", "KeyW"]);
    const onDown = (e: KeyboardEvent) => {
      if (!codes.has(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      inputAction();
    };
    const onUp = (e: KeyboardEvent) => {
      /* ключ: без этого Space «дожимает» сфокусированную кнопку диалога */
      if (codes.has(e.code)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, [open, inputAction]);

  /* Основной цикл: пока диалог открыт и поле смонтировано — рисуем каждый кадр */
  useEffect(() => {
    if (!open || !gameReady) return;

    /* Рекорд читается при каждом открытии; сброс фазы/мира — отложенно:
       React запрещает setState синхронно в теле эффекта (как в changelog) */
    let bestVal = 0;
    try {
      bestVal = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
    } catch {
      bestVal = 0;
    }
    const initTimer = window.setTimeout(() => {
      setBest(bestVal);
      setNewBest(false);
      resetWorld();
      goPhase("ready");
    }, 0);

    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* HiDPI-размер по фактической ширине контейнера */
    const fit = () => {
      const cssW = wrap.clientWidth || 560;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round((cssW * (H / W)) * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    lastTsRef.current = 0;
    const frame = (ts: number) => {
      rafRef.current = requestAnimationFrame(frame);
      if (!lastTsRef.current) {
        lastTsRef.current = ts;
        return;
      }
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;

      const p = phaseRef.current;
      const k = canvas.width / W;

      /* --- обновление мира --- */
      if (p === "playing") {
        timeRef.current += dt;
        distRef.current += speedRef.current * dt;
        speedRef.current = Math.min(SPEED_MAX, SPEED_START + timeRef.current * SPEED_GAIN);
        /* спавн по дистанции: первые три рулона — фиксированный онбординг
           (средний → низкий → высокий), дальше случайные 3 уровня высоты */
        if (distRef.current >= spawnAtRef.current) {
          spawnCountRef.current += 1;
          const n = spawnCountRef.current;
          const bx = W + 30;
          if (n === 1) {
            /* одиночный средний рулон + гарантированная монетка ПЕРЕД ним —
               на разбеге (200 px до рулона): собирается с земли до того,
               как игрок прыгнет рулон */
            obstaclesRef.current.push({ x: bx, w: 16 + Math.random() * 10, h: 24 + Math.random() * 6 });
            coinsRef.current.push({ x: bx - 200, y: GROUND_Y - 15, spin: Math.random() * Math.PI * 2 });
          } else if (n === 2) {
            /* низкий */
            obstaclesRef.current.push({ x: bx, w: 16 + Math.random() * 8, h: 16 + Math.random() * 6 });
          } else if (n === 3) {
            /* высокий */
            obstaclesRef.current.push({ x: bx, w: 18 + Math.random() * 10, h: 44 + Math.random() * 10 });
          } else {
            const r = Math.random();
            const h = r < 0.35 ? 16 + Math.random() * 6 : r < 0.75 ? 26 + Math.random() * 8 : 44 + Math.random() * 10;
            const w = 16 + Math.random() * 12;
            obstaclesRef.current.push({ x: bx, w, h });
            /* двойной кластер — только из невысоких рулонов */
            if (h < 40 && Math.random() < 0.3) {
              obstaclesRef.current.push({ x: bx + w + 8, w: 14 + Math.random() * 10, h: 16 + Math.random() * 14 });
            }
            /* монетки: над кластером (45%) или дуга из трёх в промежутке (20%) */
            const roll = Math.random();
            if (roll < 0.45) {
              const maxH = Math.max(...obstaclesRef.current.filter((o) => o.x >= bx - 1).map((o) => o.h));
              coinsRef.current.push({ x: bx + w / 2, y: GROUND_Y - maxH - 28, spin: Math.random() * Math.PI * 2 });
            } else if (roll < 0.65) {
              const cy = GROUND_Y - 46 - Math.random() * 20;
              for (let i = 0; i < 3; i++) {
                coinsRef.current.push({ x: bx + 60 + i * 34, y: cy, spin: Math.random() * Math.PI * 2 });
              }
            }
          }
          spawnAtRef.current = distRef.current + 300 + speedRef.current * 0.45 + Math.random() * 160;
        }
        for (const o of obstaclesRef.current) o.x -= speedRef.current * dt;
        obstaclesRef.current = obstaclesRef.current.filter((o) => o.x + o.w > -20);
        for (const c of coinsRef.current) {
          c.x -= speedRef.current * dt;
          c.spin += dt * 6;
        }
        coinsRef.current = coinsRef.current.filter((c) => c.x > -20);
        for (const pt of partsRef.current) {
          pt.t += dt;
          pt.x -= speedRef.current * dt;
        }
        partsRef.current = partsRef.current.filter((pt) => pt.t < 0.8);

        /* физика прыжка */
        vyRef.current += GRAVITY * dt;
        yRef.current += vyRef.current * dt;
        if (yRef.current > GROUND_Y) {
          yRef.current = GROUND_Y;
          vyRef.current = 0;
        }

        /* игрок и его AABB (прощение 4 px) */
        const py = yRef.current - PLAYER_H;
        const pl = PLAYER_X + 4, pr = PLAYER_X + PLAYER_W - 4;
        const pt2 = py + 4, pb = py + PLAYER_H;

        /* сбор монеток: щедрый бокс ±8 вокруг центра */
        for (let i = coinsRef.current.length - 1; i >= 0; i--) {
          const c = coinsRef.current[i];
          if (pr > c.x - 8 && pl < c.x + 8 && pb > c.y - 8 && pt2 < c.y + 8) {
            coinsRef.current.splice(i, 1);
            coinsCountRef.current += 1;
            partsRef.current.push({ x: c.x, y: c.y - 10, t: 0 });
          }
        }

        /* столкновение с рулонами (AABB с прощением 4 px) */
        for (const o of obstaclesRef.current) {
          const ol = o.x + 3, or_ = o.x + o.w - 3;
          const ot = GROUND_Y - o.h + 3, ob = GROUND_Y;
          if (pr > ol && pl < or_ && pb > ot && pt2 < ob) {
            const score = Math.floor(distRef.current / 12) + coinsCountRef.current * COIN_SCORE;
            let isBest = false;
            if (score > bestVal) {
              bestVal = score;
              isBest = true;
              try {
                localStorage.setItem(BEST_KEY, String(score));
              } catch {
                /* приватный режим — рекорд просто не сохранится */
              }
            }
            setBest(bestVal);
            setNewBest(isBest);
            setFinalScore(score);
            setFinalCoins(coinsCountRef.current);
            overAtRef.current = Date.now();
            goPhase("over");
            break;
          }
        }
      }

      /* --- отрисовка --- */
      const dark = document.documentElement.classList.contains("dark");
      const fg = dark ? "#f1f5f9" : "#0f172a";
      const bg = dark ? "#0f172a" : "#ffffff";

      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = fg;
      ctx.fillStyle = fg;

      /* земля со скользящими штрихами */
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y + 1);
      ctx.lineTo(W, GROUND_Y + 1);
      ctx.stroke();
      ctx.globalAlpha = 0.25;
      const dashOff = -(distRef.current % 28);
      for (let x = dashOff; x < W; x += 28) {
        ctx.fillRect(x, GROUND_Y + 8, 14, 2);
      }
      ctx.globalAlpha = 1;

      /* препятствия — рулоны ленты: скруглённый корпус + втулка */
      for (const o of obstaclesRef.current) {
        const oy = GROUND_Y - o.h;
        roundRect(ctx, o.x, oy, o.w, o.h, 5);
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(o.x + o.w / 2, oy + o.h / 2, Math.min(4, o.w / 4), 0, Math.PI * 2);
        ctx.stroke();
      }

      /* монетки — янтарный кружок, крутится (сплющивание по X) */
      for (const c of coinsRef.current) {
        const rx = Math.max(1.6, COIN_R * Math.abs(Math.cos(c.spin)));
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rx, COIN_R, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
        ctx.strokeStyle = "#b45309";
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (rx > 3.5) {
          /* «прорезь» внутри видна только анфас */
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, rx * 0.45, COIN_R * 0.45, 0, 0, Math.PI * 2);
          ctx.globalAlpha = 0.7;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      /* персонаж — квадратный «принтер» с ножками и глазом */
      const py = yRef.current - PLAYER_H;
      roundRect(ctx, PLAYER_X, py, PLAYER_W, PLAYER_H - 4, 7);
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      /* ножки: прикреплены к корпусу и летят вместе с ним — НЕ тянутся до
         земли (раньше lineTo(GROUND_Y) растягивал их в прыжке). На земле —
         бег (ступни на земле, размах за счёт legPhase), в воздухе — поджаты */
      const hipY = py + PLAYER_H - 4;
      const airborne = yRef.current < GROUND_Y - 0.5;
      ctx.lineWidth = 2.5;
      if (airborne) {
        /* поза прыжка: ноги поджаты и разведены — передняя вперёд, задняя назад */
        ctx.beginPath();
        ctx.moveTo(PLAYER_X + 10, hipY);
        ctx.lineTo(PLAYER_X + 6, hipY + 5);
        ctx.moveTo(PLAYER_X + 24, hipY);
        ctx.lineTo(PLAYER_X + 28, hipY + 4);
        ctx.stroke();
      } else {
        const legPhase = p === "playing" ? Math.sin(distRef.current / 14) * 3 : 0;
        ctx.beginPath();
        ctx.moveTo(PLAYER_X + 10, hipY);
        ctx.lineTo(PLAYER_X + 10 + legPhase, GROUND_Y);
        ctx.moveTo(PLAYER_X + 24, hipY);
        ctx.lineTo(PLAYER_X + 24 - legPhase, GROUND_Y);
        ctx.stroke();
      }
      /* глаз и «щель печати» */
      ctx.beginPath();
      ctx.arc(PLAYER_X + PLAYER_W - 9, py + 9, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.fillRect(PLAYER_X + 6, py + PLAYER_H - 13, PLAYER_W - 16, 2.5);
      ctx.globalAlpha = 1;

      /* всплывающие «+5» на месте собранных монеток */
      for (const pt of partsRef.current) {
        ctx.globalAlpha = Math.max(0, 1 - pt.t / 0.8);
        ctx.fillStyle = "#d97706";
        ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`+${COIN_SCORE}`, pt.x, pt.y - pt.t * 45);
        ctx.globalAlpha = 1;
      }

      /* счёт: текущий (дистанция + монеты) + рекорд (как HI у Chrome) */
      if (p !== "ready") {
        /* счётчик монеток слева: янтарный значок + число */
        ctx.beginPath();
        ctx.arc(20, 24, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
        ctx.strokeStyle = "#b45309";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = fg;
        ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`× ${coinsCountRef.current}`, 31, 29);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = fg;
      if (p === "ready") {
        ctx.globalAlpha = 0.55;
        ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(t("game.ready"), W - 14, 30);
        ctx.globalAlpha = 1;
      } else {
        ctx.font = "700 20px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(String(Math.floor(distRef.current / 12) + coinsCountRef.current * COIN_SCORE), W - 14, 30);
        if (bestVal > 0) {
          ctx.globalAlpha = 0.5;
          ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(`${t("game.best")} ${bestVal}`, W - 14, 47);
          ctx.globalAlpha = 1;
        }
      }
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      window.clearTimeout(initTimer);
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [open, gameReady, resetWorld, goPhase, t]);

  /* Тап/клик по игровому полю (кроме кнопок) — прыжок/старт/рестарт */
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    inputAction();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            {t("game.title")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-400 dark:text-slate-500">{t("game.subtitle")}</p>
        <div
          ref={setWrapRef}
          data-testid="game-area"
          className="relative w-full touch-none select-none overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
          style={{ aspectRatio: `${W} / ${H}` }}
          onPointerDown={onPointerDown}
        >
          <canvas ref={canvasRef} data-testid="game-canvas" className="block h-full w-full" />

          {phase === "ready" && (
            <div
              data-testid="game-ready"
              className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
            >
              <span className="rounded-full bg-slate-900/80 px-3 py-1 text-[11px] font-medium text-white dark:bg-slate-100/85 dark:text-slate-900">
                {t("game.hint")}
              </span>
            </div>
          )}

          {phase === "over" && (
            <div
              data-testid="game-over"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/85 dark:bg-slate-900/85"
            >
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("game.over")}</div>
              <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span className="tabular-nums">
                  {t("game.score")}: <b className="text-slate-900 dark:text-slate-100">{finalScore}</b>
                </span>
                <span className="tabular-nums">
                  {t("game.coins")}: <b className="text-slate-900 dark:text-slate-100">{finalCoins}</b>
                </span>
                <span className="tabular-nums">
                  {t("game.best")}: <b className="text-slate-900 dark:text-slate-100">{best}</b>
                </span>
              </div>
              {newBest && (
                <div data-testid="game-newbest" className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  <Trophy className="h-3 w-3" />
                  {t("game.newBest")}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                data-testid="game-restart"
                className="mt-1 h-8 gap-1.5 rounded-lg text-xs font-medium"
                onClick={() => {
                  startRun();
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("game.restart")}
              </Button>
            </div>
          )}
        </div>
        <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">{t("game.hint")}</p>
      </DialogContent>
    </Dialog>
  );
}
