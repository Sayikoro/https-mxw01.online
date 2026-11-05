/**
 * Тесты cat-протокола MX10 (cat-protocol.ts): сборка кадров 51 78 …,
 * CRC-8 poly 0x07, решётка RGBA→биты (LSB-first), последовательности
 * prepare/finish, полное задание buildCatJob.
 *
 * Эталоны — проверенный Python-реализатор mazoqui/thermy (thermy.py,
 * класс CatProtocol) и справочник CRC-8 (check "123456789" = 0xF4).
 * Запуск: bun scripts/test-cat-protocol.ts
 */
import {
  CAT_CMD,
  CAT_TYPE_RESPONSE,
  CAT_WIDTH,
  CAT_BYTES_PER_LINE,
  bytesFromInt,
  buildCatJob,
  catFinishFrames,
  catLineFrame,
  catPauseFrame,
  catParseState,
  catPrepareFrames,
  catResumeFrame,
  catStateSummary,
  crc8,
  makeFrame,
  reverseBits,
  rgbaToCatLines,
} from "../src/lib/printer/cat/cat-protocol";

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}
function hex(a: ArrayLike<number>): string {
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

/* ------------------------------ CRC-8 ---------------------------------- */

console.log("CRC-8 (poly 0x07, MSB-first)");
ok(crc8([0x00]) === 0x00, "crc8([0x00]) = 0x00");
ok(crc8([0x10]) === 0x70, "crc8([0x10]) = 0x70 (кадр паузы thermy)");
ok(crc8([0x02, 0x01]) === 0x2d, "crc8([0x02,0x01]) = 0x2d (хвост кадра камеры thermy)");
ok(crc8([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]) === 0xf4,
  "crc8('123456789') = 0xF4 (справочник CRC-8)");
ok(reverseBits(0b10110001) === 0b10001101, "reverseBits(0xB1) = 0x8D");
ok(reverseBits(0x00) === 0x00 && reverseBits(0xff) === 0xff, "reverseBits крайние случаи");

/* ------------------------------ Кадры ---------------------------------- */

console.log("Кадры (51 78 …)");
// Эталон thermy pause_cmd: 51 78 a3 01 01 00 10 70 ff
ok(hex(catPauseFrame()) === "51 78 a3 01 01 00 10 70 ff",
  `кадр паузы = эталон thermy (${hex(catPauseFrame())})`);
// Эталон thermy resume_cmd: 51 78 a3 01 01 00 00 00 ff
ok(hex(catResumeFrame()) === "51 78 a3 01 01 00 00 00 ff",
  `кадр возобновления = эталон thermy (${hex(catResumeFrame())})`);
// Эталон test-команды thermy (GET_DEVICE_INFO, payload 0x00):
// 51 78 a8 00 01 00 00 00 ff
ok(hex(makeFrame(CAT_CMD.GET_DEVICE_INFO, [0x00])) === "51 78 a8 00 01 00 00 00 ff",
  "GET_DEVICE_INFO = эталон thermy (пробник характеристики)");
// BITMAP строки 48 байт: кадр 6 + 48 + 2 = 56 байт
const line = new Uint8Array(CAT_BYTES_PER_LINE).fill(0xaa);
const lf = catLineFrame(line);
ok(lf.length === 56 && lf[2] === 0xa2 && lf[3] === 0 && lf[4] === 48 && lf[5] === 0,
  "BITMAP-кадр: 56 Б, cmd 0xa2, длина 48 LE");
ok(lf[6] === 0xaa && lf[53] === 0xaa, "BITMAP: payload на месте (48 Б)");
ok(lf[54] === crc8(line) && lf[55] === 0xff, "BITMAP: crc и хвост 0xff");

/* ---------------------------- bytesFromInt ----------------------------- */

console.log("bytesFromInt");
ok(hex(bytesFromInt(0x1234, 2)) === "34 12", "0x1234 → little-endian 2 байта");
ok(hex(bytesFromInt(0, 1)) === "00", "0 длиной 1 → [0x00] (как thermy)");
ok(hex(bytesFromInt(0x1234, 4)) === "34 12 00 00", "добивка нулями");

/* --------------------------- prepare/finish ---------------------------- */

console.log("prepare/finish");
const prep = catPrepareFrames(35, 8000);
ok(prep.length === 8, `prepare = 8 кадров (${prep.length})`);
ok(prep[0][2] === CAT_CMD.GET_DEVICE_STATE, "prepare[0]: get_device_state");
ok(hex(prep[1]) === "51 78 bc 00 01 02 01 2d ff",
  `prepare[1]: сырой кадр камеры thermy (${hex(prep[1])})`);
ok(prep[2][2] === CAT_CMD.SET_DPI && prep[2][6] === 0x32,
  "prepare[2]: set_dpi с payload 0x32 (как в thermy)");
ok(prep[3][2] === CAT_CMD.SPEED && prep[3][6] === 35, "prepare[3]: set_speed 35");
ok(prep[4][2] === CAT_CMD.ENERGY && prep[4][6] === 0x40 && prep[4][7] === 0x1f,
  "prepare[4]: set_energy 8000 = 0x1F40 LE");
ok(prep[5][2] === CAT_CMD.APPLY_ENERGY, "prepare[5]: apply_energy");
ok(prep[6][2] === CAT_CMD.UPDATE_DEVICE, "prepare[6]: update_device");
ok(prep[7][2] === CAT_CMD.LATTICE &&
  hex(prep[7].subarray(6, 17)) === "aa 55 17 38 44 5f 5f 5f 44 38 2c",
  "prepare[7]: start_lattice с эталонным payload thermy");
const fin = catFinishFrames(50);
ok(fin.length === 4, "finish = 4 кадра");
ok(fin[0][2] === CAT_CMD.LATTICE &&
  hex(fin[0].subarray(6, 17)) === "aa 55 17 00 00 00 00 00 00 00 17",
  "finish[0]: end_lattice с эталонным payload thermy");
ok(fin[1][2] === CAT_CMD.SPEED && fin[1][6] === 8, "finish[1]: set_speed 8");
ok(fin[2][2] === CAT_CMD.FEED && fin[2][6] === 50 && fin[2][7] === 0,
  "finish[2]: feed 50 (2 байта LE)");

/* ------------------------------ Растр ---------------------------------- */

console.log("RGBA → биты (LSB-first)");
// 8 пикселей на ПОЛНОЙ ширине 384: тёмный только первый → байт 0b00000001
{
  const px = new Uint8Array(CAT_WIDTH * 4).fill(255);
  px.set([0, 0, 0, 255]); // пиксель 0 чёрный
  const bmp = rgbaToCatLines(px, CAT_WIDTH, 1);
  ok(bmp.lines.length === 1 && bmp.lines[0].length === CAT_BYTES_PER_LINE,
    "строка нормализуется до 48 байт (384 точки)");
  ok(bmp.lines[0][0] === 0x01 && bmp.lines[0][1] === 0,
    "тёмный пиксель 0 → бит 0 (LSB-first) = 0x01");
}
// Тёмный пиксель №7 → 0x80 (полная ширина)
{
  const px = new Uint8Array(CAT_WIDTH * 4).fill(255);
  px.set([0, 0, 0, 255], 7 * 4);
  const bmp = rgbaToCatLines(px, CAT_WIDTH, 1);
  ok(bmp.lines[0][0] === 0x80, "тёмный пиксель 7 → бит 7 = 0x80");
}
// Порог на полной ширине
{
  const px = new Uint8Array(CAT_WIDTH * 4).fill(255);
  px.set([127, 127, 127, 255], 0);
  px.set([129, 129, 129, 255], 4);
  const bmp = rgbaToCatLines(px, CAT_WIDTH, 1);
  ok(bmp.lines[0][0] === 0x01, "порог 128: 127 → печать");
  ok((bmp.lines[0][0] & 0x02) === 0, "порог 128: 129 → не печатать");
}
// Центрирование: тёмный пиксель 0 при ширине 8 → позиция (384-8)/2 = 188
{
  const px = new Uint8Array(8 * 4).fill(255);
  px.set([0, 0, 0, 255], 0);
  const bmp = rgbaToCatLines(px, 8, 1);
  ok(bmp.lines[0][188 >> 3] === (1 << (188 & 7)),
    "узкий растр центрируется: бит 188 (байт 23)");
}
// Обрезка широкого растра: ширина 400 → правый хвост за 384 не уходит в память
{
  const px = new Uint8Array(400 * 4).fill(255);
  for (let x = 0; x < 400; x++) px.set([0, 0, 0, 255], x * 4);
  const bmp = rgbaToCatLines(px, 400, 1);
  ok(bmp.lines[0].length === 48, "широкий растр: строка всё равно 48 байт");
}

/* --------------------------- Задание целиком --------------------------- */

console.log("buildCatJob");
{
  // Полоска 384×2: два чёрных пикселя на каждой строке
  const h = 2;
  const px = new Uint8Array(CAT_WIDTH * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    px.set([0, 0, 0, 255], (y * CAT_WIDTH) * 4);
  }
  const job = buildCatJob(px, CAT_WIDTH, h, { speed: 35, energy: 8000, extraFeed: 50 });
  // prepare 83 Б (8 кадров) + 2 строки × 56 + finish 47 Б (4 кадра)
  ok(job.length === 83 + 2 * 56 + 47, `длина задания = prepare+строки+finish (${job.length})`);
  ok(job[0] === 0x51 && job[1] === 0x78, "задание начинается с 51 78");
  // Подсчёт BITMAP-кадров: cmd 0xa2 встречается ровно h раз
  let bitmaps = 0;
  for (let i = 0; i < job.length - 2; i++) {
    if (job[i] === 0x51 && job[i + 1] === 0x78 && job[i + 2] === CAT_CMD.BITMAP) bitmaps++;
  }
  ok(bitmaps === h, `BITMAP-кадров ровно ${h} (${bitmaps})`);
  // Хвост: последний кадр — get_device_state, перед ним feed
  ok(hex(job.subarray(job.length - 9)) === "51 78 a3 00 01 00 00 00 ff",
    "последний кадр — get_device_state");
  ok(job[job.length - 9 - 10] === 0x51 && job[job.length - 9 - 10 + 2] === CAT_CMD.FEED,
    "перед ним — feed (прогон)");
}

/* --------------------------- Состояние принтера ------------------------ */

console.log("catParseState (кадры 51 78 … 01 от принтера)");
// Пауза подачи — кадр flow-control, который присылает сам принтер
// (kitty-web data_flow_pause = 51 78 ae 01 01 00 10 70 ff):
{
  const pause = [0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff];
  const st = catParseState(pause);
  ok(st !== null && st.pause === true && st.raw === 0x10,
    "кадр 0xae с байтом 0x10 → pause=true");
  ok(st !== null && catStateSummary(st).includes("пауза"),
    `сводка паузы человекочитаема («${st ? catStateSummary(st) : ""}»)`);
}
// Полное «готов» от thermy resume_cmd (51 78 a3 01 01 00 00 00 ff):
{
  const st = catParseState(catResumeFrame());
  ok(st !== null && !st.pause && !st.outOfPaper && !st.cover && !st.overheat && !st.lowPower && !st.busy,
    "кадр 0xa3 c 0x00 → всё чисто (готов)");
  ok(catStateSummary(st!) === "готов", `сводка «готов» («${catStateSummary(st!)}»)`);
}
// Комбинированное состояние: нет бумаги (0x01) + пауза (0x10) = 0x11
{
  const st = catParseState([0x51, 0x78, 0xa3, 0x01, 0x01, 0x00, 0x11, 0x63, 0xff]);
  ok(st !== null && st.outOfPaper === true && st.pause === true,
    "state 0x11 → нет бумаги + пауза одновременно");
  ok(st !== null && catStateSummary(st).includes("нет бумаги"),
    `сводка упоминает бумагу («${st ? catStateSummary(st) : ""}»)`);
}
// Занят (0x80) и перегрев (0x04):
{
  const busy = catParseState([0x51, 0x78, 0xa3, 0x01, 0x01, 0x00, 0x80, 0x47, 0xff]);
  ok(busy !== null && busy.busy === true, "state 0x80 → busy");
  const hot = catParseState([0x51, 0x78, 0xa3, 0x01, 0x01, 0x00, 0x04, 0x1b, 0xff]);
  ok(hot !== null && hot.overheat === true, "state 0x04 → перегрев");
}
// Не кадры состояния:
ok(catParseState(catLineFrame(new Uint8Array(48))) === null,
  "TRANSFER-кадр (type=0) — не состояние");
ok(catParseState([0x51, 0x78]) === null, "обрезанный кадр — не состояние");
ok(catParseState([0xaa, 0x55, 0x17, 0x38]) === null, "чужой поток — не состояние");

console.log(failures === 0 ? "\n✓ test-cat-protocol: все проверки пройдены" : `\n✗ test-cat-protocol: упало ${failures}`);
process.exit(failures === 0 ? 0 : 1);
