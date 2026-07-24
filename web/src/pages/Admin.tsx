import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type BackendUsage, type Usage } from '../api';
import { formatBytes, usedPercent } from '../format';
import { StorageMeter } from '../components/StorageMeter';

export function Admin() {
  const [backends, setBackends] = useState<BackendUsage[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [oneDriveConfigured, setOneDriveConfigured] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
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
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addLocal(e: FormEvent) {
    e.preventDefault();
    const gb = parseFloat(quotaGB);
    if (!name.trim()) return setError('Enter a name for the storage backend.');
    if (!Number.isFinite(gb) || gb <= 0) return setError('Enter a positive quota in GB.');
    setBusy(true);
    setError('');
    try {
      await api.addLocal(name.trim(), Math.round(gb * 1024 ** 3));
      setName('');
      setQuotaGB('1');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(b: BackendUsage) {
    try {
      await api.setBackendEnabled(b.id, !b.enabled);
      await load();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function remove(b: BackendUsage) {
    if (!window.confirm(`Remove backend "${b.name}"?`)) return;
    try {
      await api.removeBackend(b.id);
      await load();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  return (
    <div className="page">
      {usage && <StorageMeter used={usage.used} total={usage.total} label="Total across all backends" />}

      <h2>Storage backends</h2>
      {error && <div className="error">{error}</div>}

      <div className="backend-grid">
        {backends.map((b) => (
          <div key={b.id} className={`card backend${b.enabled ? '' : ' disabled'}`}>
            <div className="backend-head">
              <span className="backend-name">{b.name}</span>
              <span className={`badge badge-${b.type}`}>{b.type}</span>
            </div>
            <div className="bar small">
              <div
                className={`bar-fill${usedPercent(b.used, b.total) >= 90 ? ' danger' : ''}`}
                style={{ width: `${usedPercent(b.used, b.total)}%` }}
              />
            </div>
            <div className="muted small">
              {formatBytes(b.used)} of {formatBytes(b.total)}
              {b.status === 'error' && <span className="error-inline"> · connection error</span>}
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
        ))}
        {backends.length === 0 && (
          <div className="muted">No storage backends yet. Add one below to start storing files.</div>
        )}
      </div>

      <div className="add-forms">
        <form className="card" onSubmit={addLocal}>
          <h3>Add local disk storage</h3>
          <p className="muted small">
            Stores files on the server's disk. The quota is a simulated capacity so you can model
            a fixed-size drive.
          </p>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Local drive A" />
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

        <div className="card">
          <h3>Connect a cloud backend</h3>
          <p className="muted small">
            Connect a cloud account. Its capacity is added to the combined pool and new uploads can
            land there automatically.
          </p>

          <div className="cloud-connect">
            <span className="cloud-label">OneDrive</span>
            {oneDriveConfigured ? (
              <a className="button primary" href="/api/oauth/onedrive/start">
                Connect OneDrive
              </a>
            ) : (
              <div className="notice">
                Not configured. Set <code>MS_CLIENT_ID</code> / <code>MS_CLIENT_SECRET</code> in the
                server <code>.env</code>.
              </div>
            )}
          </div>

          <div className="cloud-connect">
            <span className="cloud-label">Google Drive</span>
            {googleConfigured ? (
              <a className="button primary" href="/api/oauth/google/start">
                Connect Google Drive
              </a>
            ) : (
              <div className="notice">
                Not configured. Set <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>{' '}
                in the server <code>.env</code>.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
