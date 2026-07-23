import { formatBytes, usedPercent } from '../format';

export function StorageMeter({
  used,
  total,
  label = 'Combined storage',
}: {
  used: number;
  total: number;
  label?: string;
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
    </div>
  );
}
