import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type BackendUsage, type Usage, type UserSummary } from '../api';
import { formatBytes, usedPercent } from '../format';
import { backendLabel, backendPillStyle } from '../backends';

/** The signed-in user's own storage backends (admins can also allocate local disk to users). */
export function Admin({
  onDataChange,
  isAdmin,
  username,
}: {
  onDataChange: () => void;
  isAdmin: boolean;
  username: string;
}) {
  const [backends, setBackends] = useState<BackendUsage[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [oneDriveConfigured, setOneDriveConfigured] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [localOn, setLocalOn] = useState(true);
  const [name, setName] = useState('');
  const [quotaGB, setQuotaGB] = useState('1');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [b, u, m] = await Promise.all([api.backends(), api.storage(), api.meta()]);
      setBackends(b);
      setUsage(u);
      setOneDriveConfigured(m.oneDriveConfigured);
      setGoogleConfigured(m.googleDriveConfigured);
      setLocalOn(m.localStorageEnabled);
      if (isAdmin) setUsers(await api.users());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    await load();
    onDataChange();
  };

  async function addLocal(e: FormEvent) {
    e.preventDefault();
    const gb = parseFloat(quotaGB);
    if (!name.trim()) return setError('Enter a name for the storage backend.');
    if (!Number.isFinite(gb) || gb <= 0) return setError('Enter a positive quota in GB.');
    setBusy(true);
    setError('');
    try {
      await api.addLocal(name.trim(), Math.round(gb * 1024 ** 3), ownerId || undefined);
      setName('');
      setQuotaGB('1');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(b: BackendUsage) {
    try {
      await api.setBackendEnabled(b.id, !b.enabled);
      await refresh();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function remove(b: BackendUsage) {
    if (!window.confirm(`Remove backend "${b.name}"?`)) return;
    try {
      await api.removeBackend(b.id);
      await refresh();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  const pct = usage ? usedPercent(usage.used, usage.total) : 0;
  // Paused local disks (local storage switched off) don't count as enabled.
  const enabledCount = backends.filter((b) => b.enabled && (b.type !== 'local' || localOn)).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Your storage</h1>
          <p className="page-sub">
            Every enabled backend you connect adds its capacity to your combined pool. New uploads
            land on whichever of your backends has room. Other users cannot see your drives.
          </p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {usage && (
        <div className="pool-panel">
          <div className="head">
            <strong>Total across all backends</strong>
            <span>
              {formatBytes(usage.used)} of {formatBytes(usage.total)} · {pct}%
            </span>
          </div>
          <div className="pool-track">
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="pool-stats">
            <div className="pool-stat">
              <div className="value">
                {enabledCount}/{backends.length}
              </div>
              <div className="label">Backends enabled</div>
            </div>
            <div className="pool-stat">
              <div className="value">{formatBytes(usage.used)}</div>
              <div className="label">Used</div>
            </div>
            <div className="pool-stat">
              <div className="value">{formatBytes(usage.free)}</div>
              <div className="label">Free</div>
            </div>
            <div className="pool-stat">
              <div className="value">{formatBytes(usage.total)}</div>
              <div className="label">Capacity</div>
            </div>
          </div>
        </div>
      )}

      <div className="backend-grid">
        {backends.map((b) => {
          const bp = usedPercent(b.used, b.total);
          // A local disk is paused (no new uploads, not in the pool) while local storage is off.
          const paused = b.type === 'local' && !localOn;
          return (
            <div key={b.id} className={`card backend${b.enabled && !paused ? '' : ' disabled'}`}>
              <div className="backend-head">
                <span className="backend-name">{b.name}</span>
                <span className="backend-pill" style={backendPillStyle(b.type)}>
                  {backendLabel(b.type)}
                </span>
              </div>
              <div className="bar small">
                <div
                  className={`bar-fill${bp >= 90 ? ' danger' : ''}`}
                  style={{ width: `${bp}%` }}
                />
              </div>
              <div className="muted small">
                {formatBytes(b.used)} of {formatBytes(b.total)} · {bp}%
                {b.status === 'error' && (
                  <span className="error-inline"> · connection error</span>
                )}
                {paused && <span> · paused: local storage is turned off</span>}
              </div>
              <div className="backend-actions">
                <label className="switch">
                  <input type="checkbox" checked={b.enabled} onChange={() => toggle(b)} />
                  {b.enabled ? 'Enabled' : 'Disabled'}
                </label>
                <button className="link danger" onClick={() => remove(b)}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        {backends.length === 0 && (
          <div className="muted">
            No storage backends yet. Connect a drive below to start storing files.
          </div>
        )}
      </div>

      <div className="add-forms">
        {isAdmin && !localOn && (
          <div className="card">
            <h3>Local disk storage</h3>
            <div className="notice">
              Turned off. Turn it on under <strong>Account &amp; users → Site settings</strong> to
              add local disks or use existing ones again.
            </div>
          </div>
        )}
        {isAdmin && localOn && (
          <form className="card" onSubmit={addLocal}>
            <h3>Add local disk storage</h3>
            <p className="muted small">
              Stores files on the server's disk. The quota is a simulated capacity so you can model
              a fixed-size drive. Only admins can allocate it, to themselves or to another user.
            </p>
            <label>
              For user
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Me</option>
                {users
                  .filter((u) => u.username !== username)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Local drive A"
              />
            </label>
            <label>
              Quota (GB)
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={quotaGB}
                onChange={(e) => setQuotaGB(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy} type="submit">
              {busy ? 'Adding…' : 'Add local storage'}
            </button>
          </form>
        )}

        <div className="card">
          <h3>Connect a cloud backend</h3>
          <p className="muted small">
            Sign in to your own OneDrive or Google Drive account. Its capacity joins your pool and
            new uploads can land there automatically.
          </p>

          <div className="cloud-connect">
            <span className="cloud-label">OneDrive</span>
            {oneDriveConfigured ? (
              <a className="button primary" href="/api/oauth/onedrive/start">
                Connect
              </a>
            ) : (
              <NotConfigured isAdmin={isAdmin} vars={['MS_CLIENT_ID', 'MS_CLIENT_SECRET']} />
            )}
          </div>

          <div className="cloud-connect">
            <span className="cloud-label">Google Drive</span>
            {googleConfigured ? (
              <a className="button primary" href="/api/oauth/google/start">
                Connect
              </a>
            ) : (
              <NotConfigured
                isAdmin={isAdmin}
                vars={['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Explains why a cloud provider can't be connected: admins get the fix, users who to ask. */
function NotConfigured({ isAdmin, vars }: { isAdmin: boolean; vars: [string, string] }) {
  if (!isAdmin) {
    return <div className="notice">Not available yet — ask your admin to enable it.</div>;
  }
  return (
    <div className="notice">
      Not configured — set <code>{vars[0]}</code> / <code>{vars[1]}</code> in the server{' '}
      <code>.env</code>.
    </div>
  );
}
