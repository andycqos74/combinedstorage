import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type BackendUsage, type Usage, type UserSummary } from '../api';
import { formatBytes, usedPercent } from '../format';
import { backendLabel, backendTone } from '../backends';
import { SegmentedBar, poolMeta } from '../components/StorageMeter';
import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  MonoLabel,
  Select,
  Switch,
  Toast,
  type ToastMessage,
} from '../components/ui';

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
  const [usage, setUsage] = useState<Usage | null>(null);
  const [oneDriveConfigured, setOneDriveConfigured] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [localOn, setLocalOn] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<BackendUsage | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

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

  async function toggle(b: BackendUsage) {
    try {
      await api.setBackendEnabled(b.id, !b.enabled);
      await refresh();
    } catch (err) {
      setToast({ text: errorMessage(err), tone: 'danger' });
    }
  }

  function connect(provider: 'onedrive' | 'google', label: string) {
    setToast({ text: `Redirecting to ${label} sign-in`, tone: 'info' });
    window.location.href = `/api/oauth/${provider}/start`;
  }

  // Paused local disks (local storage switched off) don't count as enabled.
  const isPaused = (b: BackendUsage) => b.type === 'local' && !localOn;
  const enabledCount = backends.filter((b) => b.enabled && !isPaused(b)).length;

  return (
    <div className="page">
      <div className="page-intro">
        <h1 className="h1">Storage backends</h1>
        <p className="body">
          Every enabled backend adds its capacity to one combined pool. New uploads land on
          whichever backend has room.
        </p>
      </div>

      {error && <div className="banner-error">{error}</div>}

      {usage && (
        <div className="inverse-card">
          <div className="row-between">
            <span className="meter-title">Total across all backends</span>
            <MonoLabel>{poolMeta(usage.used, usage.total)}</MonoLabel>
          </div>
          <SegmentedBar backends={usage.backends} total={usage.total} inverse />
          <div className="stats">
            <Stat value={`${enabledCount}/${backends.length}`} label="Backends enabled" />
            <Stat value={formatBytes(usage.used)} label="Used" />
            <Stat value={formatBytes(usage.free)} label="Free" />
            <Stat value={formatBytes(usage.total)} label="Capacity" />
          </div>
        </div>
      )}

      {backends.length > 0 ? (
        <div className="backend-grid">
          {backends.map((b) => {
            const bp = usedPercent(b.used, b.total);
            const paused = isPaused(b);
            return (
              <div
                key={b.id}
                className={`card backend-card${b.enabled && !paused ? '' : ' disabled'}`}
              >
                <div className="backend-head">
                  <span className="backend-name">{b.name}</span>
                  <Badge tone={backendTone(b.type)}>{backendLabel(b.type)}</Badge>
                </div>
                <div className="backend-usage">
                  <div className="bar">
                    <div
                      className={`bar-fill${bp >= 90 ? ' danger' : ''}`}
                      style={{ width: `${bp}%` }}
                    />
                  </div>
                  <div className="backend-meta mono-meta">
                    <span>{poolMeta(b.used, b.total)}</span>
                    {b.status === 'error' && <span className="text-danger">· CONNECTION ERROR</span>}
                    {bp >= 90 && <span className="text-danger">· NEARLY FULL</span>}
                    {paused && <span>· PAUSED: LOCAL STORAGE IS OFF</span>}
                  </div>
                </div>
                <div className="card-foot">
                  <Switch
                    checked={b.enabled}
                    onChange={() => toggle(b)}
                    label={b.enabled ? 'Enabled' : 'Disabled'}
                  />
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(b)}>
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="body">No storage backends yet. Add one below to start storing files.</p>
      )}

      <div className="form-grid">
        {isAdmin &&
          (localOn ? (
            <AddLocal
              users={users.filter((u) => u.username !== username)}
              onAdded={async (name) => {
                setToast({ text: `Added ${name}` });
                await refresh();
              }}
            />
          ) : (
            <div className="card">
              <div className="card-head">
                <h3 className="h3">Add local disk storage</h3>
                <p className="body-s">
                  Local disk storage is turned off for this site. Turn it on under{' '}
                  <strong>Account &amp; users → Site settings</strong> to add local disks or use
                  existing ones again.
                </p>
              </div>
            </div>
          ))}

        <div className="card">
          <div className="card-head">
            <h3 className="h3">Connect a cloud backend</h3>
            <p className="body-s">
              Its capacity joins the combined pool and new uploads can land there automatically.
            </p>
          </div>
          <div className="cloud-list">
            <CloudRow
              name="OneDrive"
              configured={oneDriveConfigured}
              isAdmin={isAdmin}
              vars={['MS_CLIENT_ID', 'MS_CLIENT_SECRET']}
              onConnect={() => connect('onedrive', 'Microsoft')}
            />
            <CloudRow
              name="Google Drive"
              configured={googleConfigured}
              isAdmin={isAdmin}
              vars={['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']}
              onConnect={() => connect('google', 'Google')}
            />
          </div>
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove backend “${removing.name}”?`}
          body="Its capacity leaves the combined pool."
          action="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await api.removeBackend(removing.id);
              await refresh();
            } catch (err) {
              setToast({ text: errorMessage(err), tone: 'danger' });
            }
            setRemoving(null);
          }}
        />
      )}

      {toast && <Toast message={toast} onDone={dismissToast} />}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <MonoLabel>{label}</MonoLabel>
    </div>
  );
}

/** Admin-only form: a local-disk backend for themselves or another user. */
function AddLocal({
  users,
  onAdded,
}: {
  users: UserSummary[];
  onAdded: (name: string) => Promise<void>;
}) {
  const [ownerId, setOwnerId] = useState('');
  const [name, setName] = useState('');
  const [quotaGB, setQuotaGB] = useState('1');
  const [nameError, setNameError] = useState('');
  const [quotaError, setQuotaError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const gb = parseFloat(quotaGB);
    if (!name.trim()) return setNameError('Enter a name for the storage backend.');
    if (!Number.isFinite(gb) || gb <= 0) return setQuotaError('Enter a positive quota in GB.');
    setBusy(true);
    setError('');
    try {
      await api.addLocal(name.trim(), Math.round(gb * 1024 ** 3), ownerId || undefined);
      const added = name.trim();
      setName('');
      setQuotaGB('1');
      await onAdded(added);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head">
        <h3 className="h3">Add local disk storage</h3>
        <p className="body-s">
          Stores files on the server's disk. The quota is a simulated capacity so you can model a
          fixed-size drive.
        </p>
      </div>
      {users.length > 0 && (
        <Select label="For user" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Me</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </Select>
      )}
      <Input
        label="Name"
        placeholder="e.g. Local drive A"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setNameError('');
        }}
        error={nameError}
      />
      <Input
        label="Quota (GB)"
        type="number"
        min="0.001"
        step="0.001"
        value={quotaGB}
        onChange={(e) => {
          setQuotaGB(e.target.value);
          setQuotaError('');
        }}
        error={quotaError}
      />
      {error && <div className="banner-error">{error}</div>}
      <div>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add local storage'}
        </Button>
      </div>
    </form>
  );
}

/** One provider row: Connect when configured; otherwise who can fix it, and how. */
function CloudRow({
  name,
  configured,
  isAdmin,
  vars,
  onConnect,
}: {
  name: string;
  configured: boolean;
  isAdmin: boolean;
  vars: [string, string];
  onConnect: () => void;
}) {
  return (
    <div className="cloud-row">
      <div className="cloud-row-head">
        <span className="cloud-name">{name}</span>
        {configured ? (
          <Button size="sm" onClick={onConnect}>
            Connect
          </Button>
        ) : (
          <Badge tone="warning">Not configured</Badge>
        )}
      </div>
      {!configured && (
        <div className="note">
          {isAdmin ? (
            <>
              Set <code>{vars[0]}</code> and <code>{vars[1]}</code> in the server <code>.env</code>.
            </>
          ) : (
            'Ask your admin to enable it.'
          )}
        </div>
      )}
    </div>
  );
}
