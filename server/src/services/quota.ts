import {
  type BackendRow,
  listUsableBackends,
  setBackendQuotaCache,
  setBackendStatus,
} from '../models/backends';
import { providerFor } from '../storage/registry';

export interface BackendUsage {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  total: number;
  used: number;
  free: number;
}

export interface AggregateUsage {
  total: number;
  used: number;
  free: number;
  backends: BackendUsage[];
}

/**
 * Live usage for one backend. Refreshes the provider's quota, updates the cached values,
 * and repairs/marks the backend's status. Falls back to cached numbers if the provider
 * cannot be reached, so the UI still renders.
 */
export async function backendUsage(row: BackendRow): Promise<BackendUsage> {
  let total = row.quota_total ?? 0;
  let used = row.quota_used ?? 0;
  let status = row.status;

  try {
    const q = await providerFor(row).quota();
    total = q.total;
    used = q.used;
    status = 'connected';
    setBackendQuotaCache(row.id, total, used);
    if (row.status !== 'connected') setBackendStatus(row.id, 'connected');
  } catch {
    status = 'error';
    if (row.status !== 'error') setBackendStatus(row.id, 'error');
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: !!row.enabled,
    status,
    total,
    used,
    free: Math.max(0, total - used),
  };
}

/**
 * The combined view the file manager shows: the sum of every usable backend's capacity
 * and usage. This is what makes a 1 GB local + 1 GB OneDrive appear as one 2 GB drive.
 */
export async function aggregateQuota(): Promise<AggregateUsage> {
  const rows = listUsableBackends();
  const backends = await Promise.all(rows.map(backendUsage));
  const total = backends.reduce((sum, b) => sum + b.total, 0);
  const used = backends.reduce((sum, b) => sum + b.used, 0);
  return { total, used, free: Math.max(0, total - used), backends };
}
