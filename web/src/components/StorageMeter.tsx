import { formatBytes, usedPercent } from '../format';
import { backendColor } from '../backends';
import type { BackendUsage } from '../api';

export function StorageMeter({
  used,
  total,
  label = 'Combined storage',
  backends,
}: {
  used: number;
  total: number;
  label?: string;
  /** When given, a legend shows how much of the pool each backend is holding. */
  backends?: BackendUsage[];
}) {
  const pct = usedPercent(used, total);
  const danger = pct >= 90;

  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="muted">
          {formatBytes(used)} of {formatBytes(total)} · {pct}%
        </span>
      </div>
      <div className="bar">
        <div className={`bar-fill${danger ? ' danger' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      {backends && backends.length > 0 && (
        <div className="meter-legend">
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
