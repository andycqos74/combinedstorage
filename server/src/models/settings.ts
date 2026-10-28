import { db } from '../db';
import { config } from '../config';

/** Site-wide settings an admin can change at runtime. */
export interface Settings {
  /**
   * Whether local-disk backends are in use. When off, no new local disks can be added, and
   * existing ones take no new uploads and drop out of the pool; their files stay readable so
   * they can be moved off or deleted.
   */
  localStorageEnabled: boolean;
}

function readSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function getSettings(): Settings {
  return {
    localStorageEnabled: readSetting('localStorageEnabled', config.localStorageDefault),
  };
}

export function localStorageEnabled(): boolean {
  return getSettings().localStorageEnabled;
}

/** Apply the recognised fields of a partial update and return the result. */
export function updateSettings(changes: Partial<Record<keyof Settings, unknown>>): Settings {
  if (typeof changes.localStorageEnabled === 'boolean') {
    writeSetting('localStorageEnabled', changes.localStorageEnabled);
  }
  return getSettings();
}
