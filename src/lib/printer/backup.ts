/**
 * ============================================================================
 *  БЭКАП / ВОССТАНОВЛЕНИЕ данных приложения — слой приложения.
 * ============================================================================
 *  Всё состояние редакторов живёт в localStorage. Бэкап собирает данные
 *  в один JSON-файл: перенос на другой компьютер, резервная копия перед
 *  очисткой браузера. Восстановление пишет ключи обратно и перезагружает
 *  страницу (выполняет вызывающий код).
 *
 *  Формат v2 (с v1.0.30): в файл попадают ВСЕ ключи приложения с префиксом
 *  «mxw01-» — лента, инструменты, шаблоны ценников, настройки (язык, тема,
 *  длина этикетки, качество превью, транспорт печати) и счётчик ленты.
 *  Служебные ключи (согласие на cookie, плашка установки) в бэкап не входят.
 *
 *  Формат v1 (старые бэкапы): фиксированный список ключей редакторов —
 *  восстанавливается как раньше.
 *
 *  Драйвер принтера и логика печати здесь не участвуют.
 * ============================================================================
 */

const LS_PREFIX = "mxw01-";

/** Ключи localStorage старого формата v1 */
export const BACKUP_KEYS = [
  "mxw01-pricetags", // товары ценников
  "mxw01-pricetag-style", // типография ценников
  "mxw01-pricetag-templates", // свои шаблоны ценников
  "mxw01-text-fields", // текстовые поля
  "mxw01-tool-qr", // инструмент: QR-код
  "mxw01-tool-wifi", // инструмент: Wi-Fi этикетка
  "mxw01-tool-checklist", // инструмент: чек-лист
  "mxw01-tool-receipt", // инструмент: чек
  "mxw01-tool-dates", // инструмент: сроки годности
  "mxw01-tool-numbers", // инструмент: нумерация
  "mxw01-tool-calendar", // инструмент: календарь
  "mxw01-tool-habits", // инструмент: трекер привычек
] as const;

/**
 * Служебные ключи, которые НЕ входят в бэкап v2 и НЕ удаляются сбросом:
 * согласие на аналитику и плашка установки PWA — решения о сайте, а не
 * данные терминала.
 */
export const SERVICE_KEYS: readonly string[] = [
  "mxw01-cookie-consent", // согласие на аналитику
  "mxw01-install-dismissed", // плашка «Установить приложение» отложена
];

export const BACKUP_APP_ID = "mxw01-web-print";
export const BACKUP_VERSION = 2;

/** Все ключи данных приложения (для бэкапа v2 и полного сброса) */
export function allAppKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(LS_PREFIX) && !SERVICE_KEYS.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
}

export interface BackupFile {
  app: string;
  version: number;
  /** ISO-дата создания */
  created: string;
  /** Сырые значения localStorage по ключам */
  keys: Record<string, string>;
}

/** Собрать бэкап из текущего localStorage (пустые ключи не включаются) */
export function collectBackup(): BackupFile {
  const keys: Record<string, string> = {};
  if (typeof window !== "undefined") {
    for (const key of allAppKeys(window.localStorage)) {
      const value = window.localStorage.getItem(key);
      if (value !== null) keys[key] = value;
    }
  }
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    created: new Date().toISOString(),
    keys,
  };
}

/** Имя файла бэкапа: mxw01-backup-2026-09-08.json */
export function backupFileName(date = new Date()): string {
  const iso = date.toISOString().slice(0, 10);
  return `mxw01-backup-${iso}.json`;
}

/** Ключи, допустимые в файле конкретной версии (v1 — фиксированный список) */
function keysOfVersion(version: number, raw: Record<string, unknown>): Record<string, string> {
  const keys: Record<string, string> = {};
  if (version <= 1) {
    for (const key of BACKUP_KEYS) {
      const value = raw[key];
      if (typeof value === "string") keys[key] = value;
    }
    return keys;
  }
  for (const key of Object.keys(raw)) {
    if (!key.startsWith(LS_PREFIX) || SERVICE_KEYS.includes(key)) continue;
    const value = raw[key];
    if (typeof value === "string") keys[key] = value;
  }
  return keys;
}

/** Проверить и разобрать JSON бэкапа; null — файл не похож на наш бэкап */
export function parseBackupText(text: string): BackupFile | null {
  try {
    const parsed = JSON.parse(text) as Partial<BackupFile>;
    if (parsed?.app !== BACKUP_APP_ID) return null;
    if (
      typeof parsed.version !== "number" ||
      parsed.version < 1 ||
      parsed.version > BACKUP_VERSION
    ) {
      return null;
    }
    if (!parsed.keys || typeof parsed.keys !== "object") return null;
    return {
      app: BACKUP_APP_ID,
      version: parsed.version,
      created: typeof parsed.created === "string" ? parsed.created : "",
      keys: keysOfVersion(parsed.version, parsed.keys as Record<string, unknown>),
    };
  } catch {
    return null;
  }
}

/**
 * Записать ключи бэкапа в localStorage.
 * Возвращает список восстановленных ключей (пустой массив — в файле не было
 * ни одного известного ключа).
 */
export function applyBackupFile(file: BackupFile): string[] {
  const restored: string[] = [];
  if (typeof window === "undefined") return restored;
  for (const key of Object.keys(file.keys)) {
    window.localStorage.setItem(key, file.keys[key]);
    restored.push(key);
  }
  return restored;
}

/** Скачать бэкап как файл. Возвращает имя файла. */
export function downloadBackup(): string {
  const data = collectBackup();
  const name = backupFileName();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return name;
}

/** Прочитать файл бэкапа и применить. Возвращает восстановленные ключи. */
export async function restoreBackupFromFile(file: File): Promise<string[]> {
  const text = await file.text();
  const parsed = parseBackupText(text);
  if (!parsed) {
    throw new Error("Файл не похож на бэкап этого приложения");
  }
  return applyBackupFile(parsed);
}

/**
 * «Сбросить всё»: удалить ВСЕ ключи данных приложения (mxw01-*) кроме
 * служебных (согласие на аналитику, плашка установки). Возвращает число
 * удалённых ключей. Перезагрузку страницы выполняет вызывающий код.
 */
export function resetAllData(): number {
  if (typeof window === "undefined") return 0;
  const keys = allAppKeys(window.localStorage);
  for (const key of keys) window.localStorage.removeItem(key);
  return keys.length;
}
