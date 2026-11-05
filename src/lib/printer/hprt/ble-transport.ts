/**
 * ============================================================================
 *  BLE-ТРАНСПОРТ ДЛЯ HPRT-ЭТИКЕТОЧНИКОВ (HM-T260LR и совместимые).
 * ============================================================================
 *  Третий транспорт печати рядом с BLE (MXW01) и POS-USB. Отличия от MXW01:
 *  HPRT не публикует свой BLE-профиль, а рекламное имя устройства заранее
 *  неизвестно («HM-T260LR», «T260LR-XXXX», локализованные варианты), поэтому:
 *
 *    1. requestDevice({ acceptAllDevices: true, optionalServices: … }) —
 *       фильтра по имени нет, принтер выбирает пользователь; доступ к GATT
 *       ограничен списком optionalServices (известные «серийные» профили
 *       мобильных принтеров + Generic Access / Device Information);
 *    2. автопрофиль: пробуем известные профили в порядке вероятности
 *       (FF00 → FFE0 → Microchip UART → Nordic UART → AE00), иначе общий
 *       поиск первой write-характеристики среди доступных сервисов;
 *    3. send() — нарезка на чанки (по умолчанию 20 байт — минимальный
 *       ATT-пакет, понимается всеми модулями BLE 4.0), writeWithoutResponse
 *       там, где характеристика позволяет, пауза между чанками (по умолчанию
 *       15 мс — значение проверенного драйвера MXW01; без паузы дешёвые
 *       BLE-модули теряют пакеты, принтер получает битый TSPL и МОЛЧА
 *       выбрасывает задание — тост «отправлено» при этом честный:
 *       GATT-записи все прошли), пауза настраивается в диагностике;
 *    4. диагностика: enumerateServices() возвращает карту сервисов/
 *       характеристик для страницы «Диагностика Bluetooth», sendRaw() шлёт
 *       сырые байты (raw-консоль) — подбор протокола под конкретное
 *       устройство без пересборки.
 *
 *  Типы Web Bluetooth объявлены локально (узкие, только используемое) —
 *  без ambient-деклараций, чтобы не конфликтовать с типами библиотек.
 * ============================================================================
 */

/* ------------------------------ BT-типы ------------------------------- */

interface BtCharacteristicProps {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
}

interface BtCharacteristic {
  uuid: string;
  properties: BtCharacteristicProps;
  writeValue(data: BufferSource): Promise<void>;
  writeValueWithoutResponse(data: BufferSource): Promise<void>;
  startNotifications(): Promise<BtCharacteristic>;
  addEventListener(type: "characteristicvaluechanged", listener: (e: Event) => void): void;
}

interface BtService {
  uuid: string;
  getCharacteristic(characteristic: string | number): Promise<BtCharacteristic>;
  getCharacteristics(): Promise<BtCharacteristic[]>;
}

interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BtService>;
  getPrimaryServices(): Promise<BtService[]>;
}

interface BtDevice {
  id: string;
  name?: string | null;
  gatt?: BtServer;
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
}

interface BtNavigator {
  bluetooth?: {
    requestDevice(options: {
      acceptAllDevices?: boolean;
      optionalServices?: (string | number)[];
    }): Promise<BtDevice>;
  };
}

/** Доступ к Web Bluetooth: сам API и requestDevice() */
export function webBluetoothAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    const bt = (navigator as unknown as BtNavigator).bluetooth;
    return typeof bt?.requestDevice === "function";
  } catch {
    return false;
  }
}

/* --------------------------- Состояние cat-принтера -------------------- */
// Парсер кадров 51 78 … 01 живёт в чистом cat-модуле (общий с cat-транспортом
// и тестами); транспорт только хранит последнее состояние и ждёт паузу.
import { catParseState, catStateSummary, type CatPrinterState } from "../cat/cat-protocol";

/* --------------------------- Известные профили ------------------------- */

const MICROCHIP_SERVICE = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const MICROCHIP_WRITE = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const MICROCHIP_WRITE_NORSP = "49535343-1e4d-4bd9-ba46-24f9fca6c0af";
const MICROCHIP_NOTIFY = "49535343-aca3-481c-91ec-d366e03a8819";
const NORDIC_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";

interface KnownProfile {
  name: string;
  service: string | number;
  writes: (string | number)[];
  notify?: string | number;
}

/** Порядок = вероятность для мобильных этикеточников */
const KNOWN_PROFILES: KnownProfile[] = [
  {
    // v1.0.63: ae30 — сервис «котиковых» принтеров (MX10 и родня) ПО kitty-web,
    // первоисточнику cat-протокола: печатающая пара ae01 (write) + ae02 (notify).
    // Именно на ae30 падают MX10-клоны (его же требует и MXW01-драйвер — см.
    // подсказку «переключитесь на MX10 (cat)»), поэтому для cat-транспорта он
    // ПЕРВЫЙ. Для HPRT-устройств сервиса нет — просто skip.
    name: "AE30 (cat MX10, kitty-web)",
    service: 0xae30,
    writes: [0xae01],
    notify: 0xae02,
  },
  {
    // af30 — альтернативный сервис той же пары (macOS-вариант из драйвера MXW01)
    name: "AF30 (cat alt)",
    service: 0xaf30,
    writes: [0xae01],
    notify: 0xae02,
  },
  {
    name: "FF00 (HPRT / serial port)",
    service: 0xff00,
    writes: [0xff02, 0xff01],
    notify: 0xff01,
  },
  {
    name: "FFE0 (BLE-UART HM-10)",
    service: 0xffe0,
    writes: [0xffe1],
    notify: 0xffe1,
  },
  {
    name: "Microchip Transparent UART",
    service: MICROCHIP_SERVICE,
    writes: [MICROCHIP_WRITE, MICROCHIP_WRITE_NORSP],
    notify: MICROCHIP_NOTIFY,
  },
  {
    name: "Nordic UART Service",
    service: NORDIC_SERVICE,
    writes: ["6e400002-b5a3-f393-e0a9-e50e24dcca9e"],
    notify: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  },
  {
    name: "AE00 (Marklife/Pristar)",
    service: 0xae00,
    writes: [0xae01, 0xae10],
  },
  {
    // v1.0.61: AB00 — сервис «котиковых» принтеров (MX10, порт thermy),
    // пишем в AB01; добавлен ПЕРЕД общим поиском
    name: "AB00 (MX10/cat)",
    service: 0xab00,
    writes: [0xab01],
  },
];

/**
 * Список optionalServices для requestDevice: всё, что мы умеем находить.
 * 16-битные сервисы — числовыми алиасами, 128-битные — полными UUID
 * (строчными; Web Bluetooth требует нижний регистр).
 */
export const HPRT_OPTIONAL_SERVICES: (string | number)[] = [
  0xae30, // v1.0.63: cat-принтеры (MX10 и родня) — kitty-web CAT_PRINT_SRV
  0xaf30, // v1.0.63: альтернативный рекламируемый сервис cat-принтеров
  0xff00,
  0xffe0,
  0xffe5,
  0xae00,
  0xab00, // v1.0.61: MX10/cat (thermy)
  MICROCHIP_SERVICE,
  NORDIC_SERVICE,
  0x1800, // Generic Access (имя устройства)
  0x180a, // Device Information (производитель/модель)
];

/* ------------------------------ Профиль -------------------------------- */

export interface BleProfileInfo {
  /** Человекочитаемое имя профиля (для UI и журнала) */
  name: string;
  serviceUuid: string;
  writeUuid: string;
  notifyUuid: string | null;
  /** true — быстрая отправка writeWithoutResponse */
  writeWithoutResponse: boolean;
}

export interface DiscoveredCharacteristic {
  uuid: string;
  props: string[];
}

export interface DiscoveredService {
  uuid: string;
  chars: DiscoveredCharacteristic[];
}

export type HprtLogFn = (line: string) => void;
export type HprtCatStateFn = (state: CatPrinterState) => void;

/* ------------------------------ Хелперы -------------------------------- */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hex(data: DataView, max = 24): string {
  const n = Math.min(data.byteLength, max);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(data.getUint8(i).toString(16).padStart(2, "0"));
  return parts.join(" ") + (data.byteLength > max ? " …" : "");
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Ошибка транспорта с машинным ключом — контекст переводит в тост */
export class HprtBleError extends Error {
  constructor(
    public key:
      | "cancelled"
      | "noApi"
      | "noGatt"
      | "noProfile"
      | "notConnected"
      | "busy"
      | "failed"
      // v1.0.63 — честные состояния «котикового» принтера (кадры 51 78 … 01):
      | "paper"
      | "cover"
      | "overheat"
      | "lowPower"
      | "pause",
    cause?: unknown
  ) {
    super(`hprt-ble:${key}`);
    this.name = "HprtBleError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Минимальный и максимальный размер чанка (байт) */
export const HPRT_CHUNK_MIN = 8;
export const HPRT_CHUNK_MAX = 512;
export const HPRT_CHUNK_DEFAULT = 20;
/** Пауза между чанками, мс (v1.0.56): 15 — значение проверенного драйвера
 *  MXW01 (mxw01-thermal-printer, sendDataChunks: await sleep(15) после
 *  КАЖДОГО чанка). Раньше было 0 — на реальном T260LR задание молча
 *  пропадало: GATT-записи проходили, но модуль принтера при сплошном
 *  потоке терял байты, TSPL-парсер не добирал длину BITMAP и выбрасывал
 *  задание целиком. */
export const HPRT_DELAY_DEFAULT = 15;
/** Дренажная пауза после ПОСЛЕДНЕГО чанка, мс: даём модулю принтера
 *  дожевать хвост потока (PRINT 1,1) до того, как UI объявит «отправлено» */
export const HPRT_TAIL_DRAIN_MS = 50;

function clampChunk(n: number): number {
  if (!Number.isFinite(n)) return HPRT_CHUNK_DEFAULT;
  return Math.min(HPRT_CHUNK_MAX, Math.max(HPRT_CHUNK_MIN, Math.round(n)));
}

function clampDelay(n: number): number {
  if (!Number.isFinite(n)) return HPRT_DELAY_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/* ------------------------------ Транспорт ------------------------------ */

/**
 * Одна сессия Web Bluetooth: connect → автопрофиль → send × N → disconnect.
 * Один экземпляр на всё приложение живёт в hprt-printer-context.
 */
export class HprtBleTransport {
  private device: BtDevice | null = null;
  private server: BtServer | null = null;
  private writeChar: BtCharacteristic | null = null;
  private sending = false;
  /** Текущий профиль печати (после успешного connect) */
  profile: BleProfileInfo | null = null;
  /** Вызывается при gattserverdisconnected (принтер выключили/ушёл) */
  onDisconnected: (() => void) | null = null;
  /** Последнее состояние «котикового» принтера из нотификаций (или null) */
  private catState: CatPrinterState | null = null;
  /** Вызывается при каждом кадре состояния 51 78 … 01 (журнал/diagnostics) */
  onCatState: HprtCatStateFn | null = null;

  isConnected(): boolean {
    return !!this.server?.connected && !!this.writeChar;
  }

  /** Последнее состояние «котикового» принтера (null — принтер молчал) */
  lastCatState(): CatPrinterState | null {
    return this.catState;
  }

  deviceName(): string | null {
    return this.device?.name ?? null;
  }

  /**
   * Подключение: системный выбор устройства (user gesture) → GATT →
   * автопрофиль → подписка на notify (если есть). Возвращает имя устройства.
   */
  async connect(log?: HprtLogFn): Promise<string> {
    const bt = (navigator as unknown as BtNavigator).bluetooth;
    if (!bt || typeof bt.requestDevice !== "function") throw new HprtBleError("noApi");
    log?.(`${stamp()} ↔ requestDevice (acceptAllDevices, ${HPRT_OPTIONAL_SERVICES.length} services)`);
    let device: BtDevice;
    try {
      device = await bt.requestDevice({
        acceptAllDevices: true,
        optionalServices: HPRT_OPTIONAL_SERVICES,
      });
    } catch (e) {
      log?.(`${stamp()} ✕ requestDevice: ${(e as Error)?.name ?? "?"}`);
      throw new HprtBleError("cancelled", e);
    }
    this.device = device;
    device.addEventListener("gattserverdisconnected", () => {
      // Обрыв (принтер выключили, ушёл из радиуса): сбрасываем состояние —
      // контекст по onDisconnected вернёт статус «disconnected»
      this.server = null;
      this.writeChar = null;
      this.profile = null;
      this.catState = null;
      this.onDisconnected?.();
    });
    log?.(`${stamp()} ✓ device: ${device.name ?? device.id}`);
    if (!device.gatt) throw new HprtBleError("noGatt");
    let server: BtServer;
    try {
      server = await device.gatt.connect();
    } catch (e) {
      log?.(`${stamp()} ✕ gatt.connect: ${(e as Error)?.message ?? "?"}`);
      throw new HprtBleError("noGatt", e);
    }
    this.server = server;
    const found = await this.detectProfile(server, log);
    this.writeChar = found.char;
    this.profile = found.info;
    log?.(`${stamp()} ✓ profile: ${found.info.name}`);
    log?.(`${stamp()}   service ${found.info.serviceUuid}`);
    log?.(
      `${stamp()}   write   ${found.info.writeUuid} (${found.info.writeWithoutResponse ? "writeWithoutResponse" : "write"})`
    );
    if (found.notify) {
      try {
        await found.notify.startNotifications();
        found.notify.addEventListener("characteristicvaluechanged", (ev) => {
          const dv = (ev.target as { value?: DataView })?.value;
          if (!dv) return;
          log?.(`${stamp()} ← ${hex(dv)}`);
          // Кадры состояния «котикового» принтера (51 78 … 01): бумага,
          // крышка, перегрев, пауза подачи. Для остальных принтеров (TSPL,
          // HPRT) кадр не совпадёт — парсер вернёт null.
          const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
          const state = catParseState(bytes);
          if (state) {
            const changed =
              !this.catState || this.catState.raw !== state.raw;
            this.catState = state;
            if (changed) {
              log?.(`${stamp()} ← состояние принтера: ${catStateSummary(state)}`);
              this.onCatState?.(state);
            }
          }
        });
        log?.(`${stamp()} ✓ notify ${found.info.notifyUuid}`);
      } catch {
        log?.(`${stamp()} ! notify недоступен (не критично)`);
      }
    }
    return device.name ?? device.id;
  }

  /**
   * Автопрофиль: известные сервисы по порядку, иначе общий поиск первой
   * write-характеристики среди доступных сервисов (приоритет «write» над
   * «writeWithoutResponse» — подтверждаемая запись надёжнее).
   */
  private async detectProfile(
    server: BtServer,
    log?: HprtLogFn
  ): Promise<{ info: BleProfileInfo; char: BtCharacteristic; notify: BtCharacteristic | null }> {
    for (const p of KNOWN_PROFILES) {
      let svc: BtService;
      try {
        svc = await server.getPrimaryService(p.service);
      } catch {
        continue; // сервиса нет в этом устройстве (или не в optionalServices)
      }
      log?.(`${stamp()} · service ${svc.uuid} (${p.name})`);
      for (const w of p.writes) {
        let ch: BtCharacteristic;
        try {
          ch = await svc.getCharacteristic(w);
        } catch {
          continue;
        }
        if (!(ch.properties.write || ch.properties.writeWithoutResponse)) continue;
        let notify: BtCharacteristic | null = null;
        if (p.notify) {
          try {
            notify = await svc.getCharacteristic(p.notify);
          } catch {
            notify = null;
          }
        }
        return {
          char: ch,
          notify,
          info: {
            name: p.name,
            serviceUuid: svc.uuid,
            writeUuid: ch.uuid,
            notifyUuid: notify?.uuid ?? null,
            writeWithoutResponse: ch.properties.writeWithoutResponse && !ch.properties.write,
          },
        };
      }
    }
    // --- Общий поиск: всё, что нам доступно из optionalServices ---
    log?.(`${stamp()} · известные профили не найдены — общий поиск write-характеристик`);
    let services: BtService[] = [];
    try {
      services = await server.getPrimaryServices();
    } catch {
      /* пустой список — ниже честная ошибка noProfile */
    }
    for (const svc of services) {
      let chars: BtCharacteristic[] = [];
      try {
        chars = await svc.getCharacteristics();
      } catch {
        continue;
      }
      const writable = chars.filter((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (!writable.length) continue;
      const ch = writable.find((c) => c.properties.write) ?? writable[0];
      const notify = chars.find((c) => c.properties.notify || c.properties.indicate) ?? null;
      log?.(`${stamp()} · fallback: ${svc.uuid} → ${ch.uuid}`);
      return {
        char: ch,
        notify,
        info: {
          name: "Автопоиск (write)",
          serviceUuid: svc.uuid,
          writeUuid: ch.uuid,
          notifyUuid: notify?.uuid ?? null,
          writeWithoutResponse: ch.properties.writeWithoutResponse && !ch.properties.write,
        },
      };
    }
    throw new HprtBleError("noProfile");
  }

  async disconnect(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.writeChar = null;
    this.profile = null;
    this.catState = null;
    if (server?.connected) {
      try {
        server.disconnect();
      } catch {
        /* уже разорвано */
      }
    }
    this.device = null;
  }

  /**
   * Ждать, пока принтер снимет паузу подачи (кадры 51 78 … 01, бит 0x10 —
   * буфер печати полон — так делает kitty-web: while (state.pause) delay).
   * Без этого пот streamed задание переполняет буфер принтера: модуль
   * теряет байты, парсер теряет кадры — принтер молчит при честном тосте
   * «отправлено» (ровно тот отчёт, что привёл к v1.0.63).
   */
  private async waitForPrinterReady(log?: HprtLogFn): Promise<void> {
    const st = this.catState;
    if (!st) return;
    if (st.outOfPaper) throw new HprtBleError("paper");
    if (st.cover) throw new HprtBleError("cover");
    if (st.overheat) throw new HprtBleError("overheat");
    if (st.lowPower) throw new HprtBleError("lowPower");
    if (!st.pause) return;
    let waits = 0;
    log?.(`${stamp()} ⏸ принтер приостановил приём (буфер полон) — ждём…`);
    while (this.catState?.pause) {
      if (++waits > 200) throw new HprtBleError("pause"); // ~20 с
      await sleep(100);
    }
    log?.(`${stamp()} ▶ пауза снята — продолжаем`);
  }

  /**
   * Отправка потока команд чанками с паузой (по умолчанию 15 мс — см.
   * HPRT_DELAY_DEFAULT): дешёвые BLE-модули принтеров теряют байты при
   * сплошном потоке writeWithoutResponse, и TSPL-задание молча отбрасывается
   * парсером принтера. Каждые 32 чанка без паузы дополнительно отдаём кадр
   * event loop — UI не подвисает на длинных растрах. После последнего чанка
   * — дренажная пауза HPRT_TAIL_DRAIN_MS: «отправлено» означает, что хвост
   * (PRINT) покинул модуль, а не застрял в его буфере.
   *
   * v1.0.63: перед стартом и между чанками ждём снятия паузы подачи и
   * честно отказываем при бумаге/крышке/перегреве (кадры 51 78 … 01).
   */
  async send(
    bytes: Uint8Array,
    opts?: {
      chunkSize?: number;
      chunkDelayMs?: number;
      onProgress?: (p: number) => void;
      log?: HprtLogFn;
    }
  ): Promise<void> {
    const ch = this.writeChar;
    if (!this.server?.connected || !ch) throw new HprtBleError("notConnected");
    if (this.sending) throw new HprtBleError("busy");
    if (bytes.length === 0) return;
    this.sending = true;
    const chunkSize = clampChunk(opts?.chunkSize ?? HPRT_CHUNK_DEFAULT);
    const delayMs = clampDelay(opts?.chunkDelayMs ?? HPRT_DELAY_DEFAULT);
    const fast = ch.properties.writeWithoutResponse;
    let sent = 0;
    let chunks = 0;
    try {
      await this.waitForPrinterReady(opts?.log);
      for (let off = 0; off < bytes.length; off += chunkSize) {
        const part = bytes.subarray(off, Math.min(off + chunkSize, bytes.length));
        // Свежий Uint8Array — BufferSource без «хвоста» родительского буфера
        const copy = new Uint8Array(part.byteLength);
        copy.set(part);
        try {
          if (fast) await ch.writeValueWithoutResponse(copy);
          else await ch.writeValue(copy);
        } catch (e) {
          throw new HprtBleError("failed", e);
        }
        sent += part.length;
        chunks++;
        opts?.onProgress?.(sent / bytes.length);
        if (delayMs > 0) await sleep(delayMs);
        else if ((chunks & 31) === 0) await sleep(0);
        // Принтер забрал часть строк — мог сообщить паузу/состояние:
        if ((chunks & 15) === 0) await this.waitForPrinterReady(opts?.log);
      }
      // Дренаж: хвост потока (PRINT) должен дойти до MCU принтера до
      // «отправлено», иначе задание может остаться в буфере модуля
      await this.waitForPrinterReady(opts?.log);
      await sleep(HPRT_TAIL_DRAIN_MS);
      opts?.log?.(`${stamp()} ↑ ${bytes.length} B / ${chunks} чанков × ${chunkSize}, пауза ${delayMs} мс`);
    } finally {
      this.sending = false;
    }
  }

  /** Карта сервисов/характеристик — для страницы диагностики */
  async enumerateServices(): Promise<DiscoveredService[]> {
    const server = this.server;
    if (!server?.connected) throw new HprtBleError("notConnected");
    let services: BtService[] = [];
    try {
      services = await server.getPrimaryServices();
    } catch {
      return [];
    }
    const out: DiscoveredService[] = [];
    for (const svc of services) {
      let chars: BtCharacteristic[] = [];
      try {
        chars = await svc.getCharacteristics();
      } catch {
        out.push({ uuid: svc.uuid, chars: [] });
        continue;
      }
      out.push({
        uuid: svc.uuid,
        chars: chars.map((c) => {
          const p = c.properties;
          const props: string[] = [];
          if (p.read) props.push("read");
          if (p.write) props.push("write");
          if (p.writeWithoutResponse) props.push("writeWithoutResponse");
          if (p.notify) props.push("notify");
          if (p.indicate) props.push("indicate");
          return { uuid: c.uuid, props };
        }),
      });
    }
    return out;
  }

  /** Raw-консоль диагностики: те же чанки, без прогресса */
  async sendRaw(
    bytes: Uint8Array,
    opts?: { chunkSize?: number; chunkDelayMs?: number; log?: HprtLogFn }
  ): Promise<void> {
    await this.send(bytes, opts);
  }
}

export { clampChunk, clampDelay, stamp as hprtStamp };
