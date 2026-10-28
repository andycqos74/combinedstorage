import { formatBytes, usedPercent } from '../format';
import { backendColor, backendColorOnNavy } from '../backends';
import type { BackendUsage } from '../api';

/** "X OF Y · N%" — the mono meta line used on both storage cards. */
export function poolMeta(used: number, total: number): string {
  return `${formatBytes(used)} of ${formatBytes(total)} · ${usedPercent(used, total)}%`.toUpperCase();
}

/**
 * The pool bar: one pill segment per backend, each as wide as that backend's share of the
 * pool's used bytes (used / pool total), separated by 2px gaps.
 */
export function SegmentedBar({
  backends,
  total,
  inverse = false,
}: {
  backends: BackendUsage[];
  total: number;
  inverse?: boolean;
}) {
  return (
    <div className="bar bar-6" role="img" aria-label={`${formatBytes(sum(backends))} used`}>
      {backends.map((b) => (
        <span
          key={b.id}
          className="bar-fill"
          style={{
            width: `${total ? (b.used / total) * 100 : 0}%`,
            background: inverse ? backendColorOnNavy(b.type) : backendColor(b.type),
          }}
        />
      ))}
    </div>
  );
}

function sum(backends: BackendUsage[]): number {
  return backends.reduce((n, b) => n + b.used, 0);
}

/** The "Combined storage" card on the Files page. */
export function StorageMeter({
  used,
  total,
  backends,
}: {
  used: number;
  total: number;
  backends: BackendUsage[];
}) {
  return (
    <div className="card meter-card">
      <div className="row-between">
        <span className="meter-title">Combined storage</span>
        <span className="mono-label">{poolMeta(used, total)}</span>
      </div>
      <SegmentedBar backends={backends} total={total} />
      {backends.length > 0 && (
        <div className="legend">
          {backends.map((b) => (
            <span key={b.id} className="legend-item">
              <span className="legend-swatch" style={{ background: backendColor(b.type) }} />
              {b.name} · {formatBytes(b.used)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
