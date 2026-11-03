/**
 * ============================================================================
 *  WEBUSB-ТРАНСПОРТ ДЛЯ POS-ПРИНТЕРОВ (ESC/POS).
 * ============================================================================
 *  Отдельный путь печати: BLE-драйвер MXW01 и printCanvas остаются БЕЗ
 *  ИЗМЕНЕНИЙ, здесь только WebUSB:
 *    1. requestDevice() — системный выбор устройства (user gesture);
 *       фильтры — класс 7 (printer): большинство ESC/POS объявляют
 *       subclass 1 / protocol 2 (двунаправленный), но клоны бывают
 *       vendor-specific → есть резервный режим «показать все USB»;
 *    2. getDevices() — уже авторизованные раньше устройства (Chrome
 *       запоминает разрешение между сессиями);
 *    3. open → (reset между попытками) → selectConfiguration(1) →
 *       claimInterface: кандидаты — ВСЕ интерфейсы с bulk-out (класс 7
 *       приоритетнее), до 3 попыток — ОС может «держать» устройство;
 *    4. transferOut с таймаутом на чанк — зависший принтер не оставляет
 *       «висящих» открытых дескрипторов, которые ломают следующие печати;
 *    5. transferOut() чанками по 512 байт (безопасно для full-speed).
 * ============================================================================
 */

export type UsbPrinterErrorKey =
  | "cancelled" // пользователь закрыл выбор устройства / устройство не найдено
  | "noDevice" // устройство не выбрано
  | "noBulk" // у интерфейсов нет bulk-out endpoint
  | "openFailed" // open не удался (устройство занято, реэнумерация и т.п.)
  | "openDenied" // доступ запрещён: интерфейс захватил драйвер ОС (Windows)
  | "claimFailed" // claimInterface: интерфейс держит драйвер ОС/процесс/вкладка
  | "transferFailed" // ошибка transferOut (STALL/отвал и т.п.)
  | "transferTimeout"; // принтер перестал отвечать при передаче

/** Ошибка транспорта: key — ключ i18n, по нему показываем перевод */
export class UsbPrinterError extends Error {
  constructor(public key: UsbPrinterErrorKey, cause?: unknown) {
    super(`usb-printer:${key}`);
    this.name = "UsbPrinterError";
    if (cause !== undefined) this.cause = cause;
  }
}

export interface PosDeviceMeta {
  vendorId: number;
  productId: number;
  productName: string | null;
  manufacturerName: string | null;
}

/** Поддержка WebUSB (Chrome/Edge/Opera; Safari и Firefox — нет) */
export function isWebUsbSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    return typeof (navigator as Navigator).usb?.requestDevice === "function";
  } catch {
    return false;
  }
}

/**
 * Фильтры выбора: сначала «настоящие» принтерные интерфейсы (класс 7),
 * сужение вниз допускает клоны, сообщающие только classCode.
 */
const PRINTER_FILTERS: USBDeviceFilter[] = [
  { classCode: 7, subclassCode: 1, protocolCode: 2 },
  { classCode: 7, subclassCode: 1 },
  { classCode: 7 },
];

/**
 * Запрос устройства у пользователя. allDevices=true — резервный режим без
 * фильтров (vendor-specific клоны, которые не притворяются классом 7).
 */
export async function requestPosPrinter(allDevices = false): Promise<USBDevice> {
  try {
    return await navigator.usb.requestDevice({
      filters: allDevices ? [] : PRINTER_FILTERS,
    });
  } catch (e) {
    throw new UsbPrinterError("cancelled", e);
  }
}

/** Уже авторизованные в этом браузере устройства (пермиссия между сессиями) */
export async function authorizedPrinters(): Promise<USBDevice[]> {
  try {
    return await navigator.usb.getDevices();
  } catch {
    return [];
  }
}

export function deviceMeta(d: USBDevice): PosDeviceMeta {
  return {
    vendorId: d.vendorId,
    productId: d.productId,
    productName: d.productName ?? null,
    manufacturerName: d.manufacturerName ?? null,
  };
}

/** Человекочитаемое имя: productName, иначе «VID:PID» в шестнадцатеричном виде */
export function deviceDisplayName(d: USBDevice): string {
  const meta = deviceMeta(d);
  if (meta.productName) return meta.productName;
  return `USB ${pad4(meta.vendorId)}:${pad4(meta.productId)}`;
}

function pad4(n: number): string {
  return n.toString(16).padStart(4, "0");
}

interface OutEndpoint {
  interfaceNumber: number;
  endpointNumber: number;
  printer: boolean; // интерфейс класса 7 (настоящий принтерный)
}

/**
 * Все bulk-out endpoint'ы конфигурации — по одному на интерфейс.
 * Составные устройства (CDC + printer) дают несколько кандидатов; сначала
 * пробуем интерфейсы класса 7, иначе можно занять не тот (например,
 * последовательный порт CDC-Data с таким же bulk-каналом).
 */
function bulkOutCandidates(device: USBDevice): OutEndpoint[] {
  const cfg = device.configuration;
  if (!cfg) return [];
  const found: OutEndpoint[] = [];
  for (const iface of cfg.interfaces) {
    const alts = iface.alternates.length > 0 ? iface.alternates : [iface.alternate];
    let best: OutEndpoint | null = null;
    for (const alt of alts) {
      for (const ep of alt.endpoints) {
        if (ep.direction === "out" && ep.type === "bulk") {
          const cand: OutEndpoint = {
            interfaceNumber: iface.interfaceNumber,
            endpointNumber: ep.endpointNumber,
            printer: alt.interfaceClass === 7,
          };
          // среди альтернатив интерфейса предпочитаем класс 7
          if (!best || (cand.printer && !best.printer)) best = cand;
          break;
        }
      }
    }
    if (best) found.push(best);
  }
  found.sort((a, b) =>
    a.printer === b.printer ? a.interfaceNumber - b.interfaceNumber : a.printer ? -1 : 1
  );
  return found;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Максимальное ожидание одного bulk-out чанка (принтер может долго печатать) */
const TRANSFER_TIMEOUT_MS = 15000;

/** Причина неудачи открытия: «доступ запрещён» — интерфейс у драйвера ОС */
function classifyOpenFailure(e: unknown): UsbPrinterError {
  if (e instanceof UsbPrinterError) return e;
  const ex = e as { name?: string; message?: string } | null;
  const text = `${ex?.name ?? ""} ${ex?.message ?? ""}`.toLowerCase();
  if (/access|denied|security|notallowed/.test(text)) return new UsbPrinterError("openDenied", e);
  // Chromium отвергает claimInterface фразой «Unable to claim interface»
  // (имя NetworkError): интерфейс занят драйвером ОС (usblp/usbprint),
  // другим процессом или открытой вкладкой — отдельная подсказка
  if (/claim/.test(text)) return new UsbPrinterError("claimFailed", e);
  return new UsbPrinterError("openFailed", e);
}

/**
 * Сессия печати: open → claim → transferOut × N → close.
 * Один экземпляр — одна открытая сессия (создаётся на каждую печать).
 */
export class WebUsbPosPrinter {
  private device: USBDevice | null = null;
  private endpoint = -1;

  async open(device: USBDevice): Promise<void> {
    this.device = device;
    let lastErr: unknown = null;
    // До 3 попыток: первая может упасть, пока ОС «отпускает» устройство
    // (асинхронный detach kernel-драйвера на Linux, реэнумерация после
    // подключения, другой процесс ещё закрывает дескриптор и т.п.)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!device.opened) await device.open();
        // Сброс со 2-й попытки: застрявшее после неудачной печати устройство
        // (принтер «молчит», но порт не отдаёт) оживает после USB-ресета.
        // Если интерфейс держит чужой драйвер/процесс, reset падает EBUSY —
        // это не критично, продолжаем без сброса.
        if (attempt > 1) {
          try {
            await device.reset();
          } catch {
            /* занято чужим обработчиком — продолжаем без сброса */
          }
        }
        if (device.configuration === null) await device.selectConfiguration(1);
        const candidates = bulkOutCandidates(device);
        if (candidates.length === 0) throw new UsbPrinterError("noBulk");
        // Занятый драйвером ОС интерфейс не мешает занять следующий
        // (составные устройства: CDC + printer)
        let claimErr: unknown = null;
        let claimed = false;
        for (const cand of candidates) {
          try {
            await device.claimInterface(cand.interfaceNumber);
            this.endpoint = cand.endpointNumber;
            claimed = true;
            break;
          } catch (e) {
            if (claimErr === null) claimErr = e;
          }
        }
        if (!claimed) throw claimErr ?? new UsbPrinterError("openFailed");
        return; // сессия открыта
      } catch (e) {
        lastErr = e;
        this.endpoint = -1;
        // повтор бессмыслен — печатать некуда
        if (e instanceof UsbPrinterError && e.key === "noBulk") throw e;
        // закрываем недооткрытую сессию (отпускает и частичные claim'ы)
        try {
          if (device.opened) await device.close();
        } catch {
          /* уже закрыто */
        }
        if (attempt < 3) await delay(350 * attempt);
      }
    }
    throw classifyOpenFailure(lastErr);
  }

  /** Отправить готовый поток ESC/POS; onProgress — доля отправленного 0…1 */
  async send(
    bytes: Uint8Array,
    onProgress?: (p: number) => void,
    chunkSize = 512
  ): Promise<void> {
    const device = this.device;
    if (!device || this.endpoint < 0) throw new UsbPrinterError("noDevice");
    let sent = 0;
    try {
      for (let off = 0; off < bytes.length; off += chunkSize) {
        const part = bytes.subarray(off, Math.min(off + chunkSize, bytes.length));
        // Свежий Uint8Array(ArrayBuffer) — совместим с BufferSource (TS 5.7+)
        const chunk = new Uint8Array(part.byteLength);
        chunk.set(part);
        // Таймаут на чанк: зависший принтер не должен держать открытый
        // дескриптор вечно — именно «висящий» transferOut делает следующие
        // печати невозвратно занятыми (claimInterface: EBUSY)
        const xfer = device.transferOut(this.endpoint, chunk);
        // если победит таймаут, позднее отклонение transferOut не должно
        // превращаться в unhandled promise rejection
        void xfer.catch(() => {});
        const res = await Promise.race([
          xfer,
          delay(TRANSFER_TIMEOUT_MS).then(() => null),
        ]);
        if (!res) throw new UsbPrinterError("transferTimeout", { name: "TimeoutError" });
        if (res.status !== "ok") throw new UsbPrinterError("transferFailed");
        sent += chunk.length;
        onProgress?.(bytes.length > 0 ? sent / bytes.length : 1);
      }
    } catch (e) {
      if (e instanceof UsbPrinterError) throw e;
      throw new UsbPrinterError("transferFailed", e);
    }
  }

  async close(): Promise<void> {
    const device = this.device;
    this.device = null;
    this.endpoint = -1;
    if (!device) return;
    try {
      if (device.opened) await device.close();
    } catch {
      /* устройство уже отключено — не критично */
    }
  }
}
