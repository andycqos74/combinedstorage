import { listUsableBackends, type BackendRow } from '../models/backends';
import { providerFor } from '../storage/registry';
import { InsufficientSpaceError } from '../util/errors';

/**
 * Decide which backend should store an upload of `size` bytes.
 *
 * Strategy: most-free-space first. We query each usable backend's live quota and pick the
 * one with the greatest free space that can still fit the file. Backends we cannot reach
 * are skipped. If nothing fits, the caller gets a 507. Swapping this for round-robin or a
 * pinned-backend policy is a one-function change.
 */
export async function chooseBackend(size: number): Promise<BackendRow> {
  const rows = listUsableBackends();
  let best: { row: BackendRow; free: number } | null = null;

  for (const row of rows) {
    let free: number;
    try {
      const q = await providerFor(row).quota();
      free = q.total - q.used;
    } catch {
      continue; // unreachable/misconfigured backend -> not a placement candidate
    }
    if (free >= size && (best === null || free > best.free)) {
      best = { row, free };
    }
  }

  if (!best) throw new InsufficientSpaceError();
  return best.row;
}
