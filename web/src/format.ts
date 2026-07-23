/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  const text = v >= 100 || i === 0 ? Math.round(v).toString() : v.toFixed(1);
  return `${text} ${units[i]}`;
}

/** Percentage (0–100) of used/total, guarding against divide-by-zero. */
export function usedPercent(used: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}
