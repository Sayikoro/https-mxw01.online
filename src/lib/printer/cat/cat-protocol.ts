/**
 * ============================================================================
 *  CAT-ПРОТОКОЛ — печать на MX10 и родственных «котиковых» принтерах.
 * ============================================================================
 *  Четвёртый транспорт печати (v1.0.61) рядом с BLE (MXW01), HPRT и POS-USB.
 *  Портирован с проверенного Python-реализатора mazoqui/thermy (файл
 *  thermy.py, классы CatProtocol/CatPrinter — те, в свою очередь, порт
 *  cat-protocol.ts из проекта kitty-printer). Модельные имена: MX10, MX*,
 *  GB03 и соседние («XW…», «JX…», «M01», «GB01…04», «LY…», «AI01», «GT01»,
 *  «X6», «C9») — у всех один кадр и одна растровая решётка.
 *
 *  КАДР (transfer):
 *      51 78 <cmd> <type> <len_lo> <len_hi> <payload…> <crc8(payload)> ff
 *    type: 0 = transfer (мы шлём), 1 = response (только в паре готовых
 *    кадров паузы/возобновления). CRC8 — стандартный poly 0x07 (MSB-first,
 *    init 0, без финального XOR): таблица генерируется, в тестах сверяется
 *    с эталонными кадрами thermy.
 *
 *  ПЕЧАТЬ (prepare → строки → finish, как в kitty-web/thermy):
 *    prepare:  get_device_state, prepare_camera (сырой кадр 51 78 bc…),
 *              set_dpi([0x32]), set_speed, set_energy, apply_energy,
 *              update_device, start_lattice;
 *    строки:   BITMAP (0xa2) с payload = 48 байт строки (384 точки / 8);
 *              биты LSB-first, «1» = тёмный пиксель (печатать);
 *              ПОДРЯД ИДУЩИЕ ПУСТЫЕ строки не шлются как BITMAP — они
 *              превращаются в feed(n) на скорости 8 (модель kitty-web);
 *    finish:   end_lattice, set_speed(8), feed(extra_feed + хвостовые
 *              пустые строки), get_device_state.
 *
 *  ОТПРАВКА (модель kitty-web, решает проблему «печать прошла, принтер
 *  молчит»): кадры копятся в буфер 200 Б ЦЕЛЫМИ кадрами; буфер уходит
 *  одной BLE-записью ≤ 200 Б, после КАЖДОЙ записи — пауза 20 мс и
 *  проверка бита pause (0x10) из нотификаций: пока буфер принтера полон,
 *  отправка ЖДЁТ (flush() в kitty-web: while (state.pause) delay(100)).
 *  Сборка этой последовательности — buildCatFrameSequence, транспорт —
 *  HprtBleTransport.sendFrames.
 *
 *  Модуль ЧИСТЫЙ (без DOM/Web Bluetooth) — собирает кадры и растр;
 *  BLE-отправка (чанки, паузы, автопрофиль GATT) — в cat-printer-context
 *  через переиспользуемый HprtBleTransport.
 * ============================================================================
 */

/* ------------------------------ Константы ------------------------------ */

/** Команды протокола (cat-protocol.ts → thermy Command) */
export const CAT_CMD = {
  RETRACT: 0xa0,
  FEED: 0xa1,
  BITMAP: 0xa2,
  GET_DEVICE_STATE: 0xa3,
  SET_DPI: 0xa4,
  LATTICE: 0xa6,
  GET_DEVICE_INFO: 0xa8,
  UPDATE_DEVICE: 0xa9,
  SPEED: 0xbd,
  ENERGY: 0xaf,
  APPLY_ENERGY: 0xbe,
} as const;

export const CAT_TYPE_TRANSFER = 0;
export const CAT_TYPE_RESPONSE = 1;

/** Головка MX10: 384 точки (58 мм бумага, зона печати 48 мм) */
export const CAT_WIDTH = 384;
export const CAT_BYTES_PER_LINE = CAT_WIDTH / 8; // 48

/**
 * Значения по умолчанию kitty-web (constants.ts — веб-первоисточник
 * cat-протокола, проверенный на реальных ae30-принтерах): DEF_SPEED = 32,
 * DEF_ENERGY = 24000 (диапазон 12000…48000), DEF_FINISH_FEED = 100.
 * Раньше стояли дефолты thermy (35/8000/50): 8000 энергии на части
 * клонов даёт СЛИШКОМ бледную/невидимую печать — kitty-web для семейства
 * GB03/MX использует 24000.
 */
export const CAT_SPEED_DEFAULT = 32;
export const CAT_ENERGY_DEFAULT = 24000;
export const CAT_EXTRA_FEED_DEFAULT = 100;

/**
 * Размер flush-буфера (kitty-web CatPrinter.mtu = 200): кадры копятся в
 * буфер ЦЕЛЫМИ и уходят одной записью ≤ 200 Байт, после каждой записи —
 * пауза CAT_FLUSH_DELAY_MS. Произвольная нарезка потока чанками (v1.0.61)
 * переполняла приёмный буфер MCU: байты терялись, поток кадров рвался,
 * принтер молча выбрасывал задание при честном тосте «отправлено».
 */
export const CAT_FLUSH_MTU = 200;
/** Пауза после КАЖДОГО flush (kitty-web flush(): await delay(20)) */
export const CAT_FLUSH_DELAY_MS = 20;
/** Дрейн после последнего flush (kitty-web: delay(500) перед disconnect) */
export const CAT_TAIL_DRAIN_MS = 500;

/* ------------------------------ CRC8 ----------------------------------- */

/**
 * Таблица CRC-8 (poly 0x07, MSB-first, init 0): table[t] = CRC байта t.
 * Генерируется кодом — эквивалентна захардкоженной таблице thermy
 * (проверено тестами: crc8("123456789") = 0xF4, кадры паузы/состояния).
 */
const CRC8_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
    t[i] = crc;
  }
  return t;
})();

/** CRC8 потока байтов: crc = TABLE[crc ^ byte], init 0 */
export function crc8(data: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = CRC8_TABLE[(crc ^ data[i]) & 0xff];
  }
  return crc & 0xff;
}

/** Реверс битов байта (для PBM-порядка; в основном пути не нужен) */
export function reverseBits(i: number): number {
  i = ((i & 0b10101010) >> 1) | ((i & 0b01010101) << 1);
  i = ((i & 0b11001100) >> 2) | ((i & 0b00110011) << 2);
  return ((i & 0b11110000) >> 4) | ((i & 0b00001111) << 4);
}

/* ------------------------------ Кадры ---------------------------------- */

/** Сборка кадра: 51 78 cmd type len_lo len_hi payload… crc8(payload) ff */
export function makeFrame(
  command: number,
  payload: ArrayLike<number> = [],
  type: number = CAT_TYPE_TRANSFER
): Uint8Array {
  const len = payload.length;
  // 6 байт шапки + payload + CRC + хвост 0xff (итого 8 + len)
  const frame = new Uint8Array(8 + len);
  frame[0] = 0x51;
  frame[1] = 0x78;
  frame[2] = command & 0xff;
  frame[3] = type & 0xff;
  frame[4] = len & 0xff;
  frame[5] = (len >> 8) & 0xff;
  for (let i = 0; i < len; i++) frame[6 + i] = payload[i] & 0xff;
  frame[6 + len] = crc8(payload);
  frame[7 + len] = 0xff;
  return frame;
}

/** Целое → little-endian байты фиксированной длины (thermy bytes_from_int) */
export function bytesFromInt(value: number, length = 1): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length && v !== 0; i++) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

/** Сырой кадр prepare_camera из thermy (копия байт-в-байт) */
const CAMERA_FRAME = new Uint8Array([0x51, 0x78, 0xbc, 0x00, 0x01, 0x02, 0x01, 0x2d, 0xff]);

/** start_lattice: aa 55 17 38 44 5f 5f 5f 44 38 2c */
const LATTICE_START_PAYLOAD = new Uint8Array([
  0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c,
]);
/** end_lattice: aa 55 17 00 00 00 00 00 00 00 17 */
const LATTICE_END_PAYLOAD = new Uint8Array([
  0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17,
]);

/** Готовые кадры паузы/возобновления из thermy (type=RESPONSE) — про запас */
export function catPauseFrame(): Uint8Array {
  return makeFrame(CAT_CMD.GET_DEVICE_STATE, [0x10], CAT_TYPE_RESPONSE);
}
export function catResumeFrame(): Uint8Array {
  return makeFrame(CAT_CMD.GET_DEVICE_STATE, [0x00], CAT_TYPE_RESPONSE);
}

/** BITMAP-кадр одной строки растра (payload — уже упакованные байты) */
export function catLineFrame(line: ArrayLike<number>): Uint8Array {
  return makeFrame(CAT_CMD.BITMAP, line);
}

/**
 * Подготовка принтера к заданию (thermy CatPrinter.prepare):
 * state → camera → dpi → speed → energy → apply → update → start lattice.
 */
export function catPrepareFrames(speed: number, energy: number): Uint8Array[] {
  return [
    makeFrame(CAT_CMD.GET_DEVICE_STATE, bytesFromInt(0)),
    CAMERA_FRAME,
    makeFrame(CAT_CMD.SET_DPI, bytesFromInt(0x32)), // thermy шлёт 50 независимо от dpi
    makeFrame(CAT_CMD.SPEED, bytesFromInt(Math.max(1, Math.min(127, Math.round(speed))))),
    makeFrame(CAT_CMD.ENERGY, bytesFromInt(Math.max(0, Math.min(0xffff, Math.round(energy))), 2)),
    makeFrame(CAT_CMD.APPLY_ENERGY, bytesFromInt(0x01)),
    makeFrame(CAT_CMD.UPDATE_DEVICE, bytesFromInt(0)),
    makeFrame(CAT_CMD.LATTICE, LATTICE_START_PAYLOAD),
  ];
}

/** Завершение задания (thermy CatPrinter.finish) */
export function catFinishFrames(extraFeed: number): Uint8Array[] {
  return [
    makeFrame(CAT_CMD.LATTICE, LATTICE_END_PAYLOAD),
    makeFrame(CAT_CMD.SPEED, bytesFromInt(8)),
    makeFrame(CAT_CMD.FEED, bytesFromInt(Math.max(0, Math.min(0xffff, Math.round(extraFeed))), 2)),
    makeFrame(CAT_CMD.GET_DEVICE_STATE, bytesFromInt(0)),
  ];
}

/* ------------------------------ Состояние ------------------------------ */

/**
 * Состояние принтера из нотификации (kitty-web CatPrinter.notify):
 * принтер сам присылает кадры 51 78 <cmd> 01 … <state> … ff, где state —
 * битовая маска. Важнейший бит — pause (0x10): буфер принтера полон,
 * отправка обязана ждать (kitty-web flush(): while (state.pause) delay).
 */
export interface CatPrinterState {
  /** Нет бумаги */
  outOfPaper: boolean;
  /** Открыта крышка */
  cover: boolean;
  /** Перегрев головки */
  overheat: boolean;
  /** Низкий заряд батареи */
  lowPower: boolean;
  /** Пауза подачи (буфер полон) — поток данных надо приостановить */
  pause: boolean;
  /** Занят обработкой */
  busy: boolean;
  /** Сырой байт состояния */
  raw: number;
}

/** state-байт: (frame[6]) из кадра-ответа 51 78 … 01 …; null — не кадр состояния */
export function catParseState(frame: ArrayLike<number>): CatPrinterState | null {
  if (frame.length < 7) return null;
  if (frame[0] !== 0x51 || frame[1] !== 0x78) return null;
  if ((frame[3] & 0xff) !== CAT_TYPE_RESPONSE) return null;
  const s = frame[6] & 0xff;
  return {
    outOfPaper: !!(s & 0x01),
    cover: !!(s & 0x02),
    overheat: !!(s & 0x04),
    lowPower: !!(s & 0x08),
    pause: !!(s & 0x10),
    busy: !!(s & 0x80),
    raw: s,
  };
}

/** Короткая человекочитаемая сводка состояния (для журнала диагностики) */
export function catStateSummary(state: CatPrinterState): string {
  const parts: string[] = [];
  if (state.pause) parts.push("пауза (буфер полон)");
  if (state.busy) parts.push("обработка");
  if (state.outOfPaper) parts.push("нет бумаги");
  if (state.cover) parts.push("крышка");
  if (state.overheat) parts.push("перегрев");
  if (state.lowPower) parts.push("низкий заряд");
  return parts.length ? parts.join(", ") : "готов";
}

/* ------------------------------ Растр ---------------------------------- */

export interface CatBitmap {
  /** Всегда CAT_WIDTH байт на строку */
  lines: Uint8Array[];
  /** Высота в строках */
  height: number;
}

/**
 * RGBA → биты строки, LSB-first (thermy rgbaToBits): бит d = пиксель d
 * строки; «1» = тёмный пиксель (порог 128 по яркости Rec.709). Ширина
 * нормализуется к CAT_WIDTH: более узкий растр центрируется, более
 * широкий — обжимается до ширины печати (nearest).
 */
export function rgbaToCatLines(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): CatBitmap {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  // Яркость каждой строки исходника в «печатные» биты по CAT_WIDTH
  const lines: Uint8Array[] = [];
  const offsetX = w >= CAT_WIDTH ? 0 : Math.floor((CAT_WIDTH - w) / 2);
  for (let y = 0; y < h; y++) {
    const line = new Uint8Array(CAT_BYTES_PER_LINE);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i] ?? 255;
      const g = rgba[i + 1] ?? r;
      const b = rgba[i + 2] ?? r;
      const gray = 0.2125 * r + 0.7154 * g + 0.0721 * b;
      if (gray < 128) {
        const dx = x + offsetX; // при w > CAT_WIDTH offsetX = 0: правый край срезается
        if (dx >= 0 && dx < CAT_WIDTH) {
          line[dx >> 3] |= 1 << (dx & 7);
        }
      }
    }
    lines.push(line);
  }
  return { lines, height: h };
}

export interface CatPrintOptions {
  /** Скорость печати (kitty-web DEF_SPEED = 32) */
  speed?: number;
  /** Энергия (kitty-web DEF_ENERGY = 24000) */
  energy?: number;
  /** Прогон бумаги в конце, точек (kitty-web DEF_FINISH_FEED = 100) */
  extraFeed?: number;
}

/** Все байты строки нулевые → «пустая» строка (kitty-web: line.every(b => b === 0)) */
export function isCatLineBlank(line: ArrayLike<number>): boolean {
  for (let i = 0; i < line.length; i++) {
    if ((line[i] & 0xff) !== 0) return false;
  }
  return true;
}

export interface CatFrameSequence {
  /** Полная последовательность кадров: prepare + строки/feed + finish */
  frames: Uint8Array[];
  /** Суммарный размер потока (байт) — для прогресса отправки */
  totalBytes: number;
  /** Напечатанных BITMAP-строк */
  bitmapLines: number;
  /** Пустых строк, конвертированных в feed (не в BITMAP) */
  fedLines: number;
}

/**
 * Полное задание печати КАК ПОСЛЕДОВАТЕЛЬНОСТЬ КАДРОВ — точный порт
 * потока печати kitty-web (components/Preview.tsx):
 *   - prepare(speed, energy);
 *   - подряд идущие ПУСТЫЕ строки НЕ отправляются как BITMAP: они
 *     накапливаются и перед следующей содержательной строкой уходят
 *     одним feed(blank) на скорости 8 (экономия времени и буфера —
 *     сотни пустых BITMAP-кадров забивают эфир впустую);
 *   - хвостовые пустые строки добавляются к прогону finish
 *     (kitty-web: finish(blank + finish_feed));
 *   - finish(extra_feed).
 * Отправка (буфер 200 Б целых кадров, пауза, flow-control) — в
 * HprtBleTransport.sendFrames.
 */
export function buildCatFrameSequence(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  opts?: CatPrintOptions
): CatFrameSequence {
  const speed = clampPrintSpeed(opts?.speed ?? CAT_SPEED_DEFAULT);
  const energy = opts?.energy ?? CAT_ENERGY_DEFAULT;
  const extraFeed = opts?.extraFeed ?? CAT_EXTRA_FEED_DEFAULT;
  const { lines } = rgbaToCatLines(rgba, width, height);
  const frames: Uint8Array[] = [...catPrepareFrames(speed, energy)];
  let blank = 0;
  let bitmapLines = 0;
  let fedLines = 0;
  for (const line of lines) {
    if (isCatLineBlank(line)) {
      blank += 1;
      continue;
    }
    if (blank > 0) {
      // kitty-web: setSpeed(8) → feed(blank) → setSpeed(speed)
      frames.push(makeFrame(CAT_CMD.SPEED, bytesFromInt(8)));
      frames.push(makeFrame(CAT_CMD.FEED, bytesFromInt(Math.min(blank, 0xffff), 2)));
      frames.push(makeFrame(CAT_CMD.SPEED, bytesFromInt(speed)));
      fedLines += blank;
      blank = 0;
    }
    frames.push(catLineFrame(line));
    bitmapLines += 1;
  }
  // Хвостовые пустые строки уйдут в прогоне finish(blank + extra_feed) —
  // считаем их конвертированными в feed (как kitty-web)
  fedLines += blank;
  frames.push(...catFinishFrames(Math.min(blank + extraFeed, 0xffff)));
  let totalBytes = 0;
  for (const f of frames) totalBytes += f.length;
  return { frames, totalBytes, bitmapLines, fedLines };
}

function clampPrintSpeed(n: number): number {
  return Math.max(1, Math.min(127, Math.round(n)));
}

/**
 * Полное задание печати ОДНИМ буфером: prepare + строки + finish.
 * Принимает RGBA-данные холста (canvas.getContext("2d").getImageData().data).
 * ОСТАВЛЕН для совместимости/тестов; живой путь печати —
 * buildCatFrameSequence + HprtBleTransport.sendFrames (модель kitty-web).
 */
export function buildCatJob(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  opts?: CatPrintOptions
): Uint8Array {
  const { lines } = rgbaToCatLines(rgba, width, height);
  const parts: Uint8Array[] = [
    ...catPrepareFrames(opts?.speed ?? CAT_SPEED_DEFAULT, opts?.energy ?? CAT_ENERGY_DEFAULT),
    ...lines.map((l) => catLineFrame(l)),
    ...catFinishFrames(opts?.extraFeed ?? CAT_EXTRA_FEED_DEFAULT),
  ];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
