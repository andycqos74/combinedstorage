import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Role, type Settings, type UserSummary } from '../api';
import { formatBytes } from '../format';

export function Account({
  username,
  isAdmin,
  onDataChange,
}: {
  username: string;
  isAdmin: boolean;
  onDataChange: () => void;
}) {
  // Bumped when a site setting changes, so the user list re-reads capacities that depend on it.
  const [settingsVersion, setSettingsVersion] = useState(0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Account</h1>
          <p className="page-sub">
            Signed in as <strong>{username}</strong>
            {isAdmin ? ' (admin)' : ''}. Your files and drives are private to your account.
          </p>
        </div>
      </div>

      <div className="account-grid">
        <ChangePassword />
        <div className="card">
          <h3>Map as a network drive</h3>
          <p className="muted small">
            Use this WebDAV address in Windows, macOS, rclone or any WebDAV client, signing in with
            your own username and password. You will see only your own files.
          </p>
          <code className="dav-url">{`${window.location.origin}/dav/`}</code>
        </div>
      </div>

      {isAdmin && (
        <SiteSettings
          onChange={() => {
            setSettingsVersion((v) => v + 1);
            onDataChange();
          }}
        />
      )}
      {isAdmin && <Users key={settingsVersion} currentUsername={username} />}
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Change password</h3>
      <label>
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <div className="error">{error}</div>}
      {done && <div className="success">Password changed.</div>}
      <button className="primary" disabled={busy} type="submit">
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

/** Admin-only: switches that apply to every user. */
function SiteSettings({ onChange }: { onChange: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then(setSettings, (err) => setError(errorMessage(err)));
  }, []);

  async function toggleLocal() {
    if (!settings) return;
    const next = !settings.localStorageEnabled;
    if (
      !next &&
      !window.confirm(
        'Turn off local disk storage? Existing local disks stop taking new uploads and leave ' +
          'every user’s pool. Files already on them stay readable, so they can be moved or deleted.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      setSettings(await api.updateSettings({ localStorageEnabled: next }));
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Site settings</h3>
      {error && <div className="error">{error}</div>}
      {settings && (
        <div className="setting-row">
          <div>
            <strong>Local disk storage</strong>
            <p className="muted small">
              Lets admins allocate space on this server's disk to users. Turn it off to have
              everyone store files only on the cloud drives they connect.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.localStorageEnabled}
              disabled={busy}
              onChange={toggleLocal}
            />
            {settings.localStorageEnabled ? 'On' : 'Off'}
          </label>
        </div>
      )}
    </div>
  );
}

/** Admin-only: create accounts, reset passwords, change roles, delete accounts. */
function Users({ currentUsername }: { currentUsername: string }) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api.users());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createUser(username.trim(), password, role);
      setUsername('');
      setPassword('');
      setRole('user');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function resetPassword(u: UserSummary) {
    const next = window.prompt(`New password for ${u.username} (at least 8 characters):`);
    if (next) void act(() => api.updateUser(u.id, { password: next }));
  }

  function toggleRole(u: UserSummary) {
    const role: Role = u.role === 'admin' ? 'user' : 'admin';
    const verb = role === 'admin' ? 'Make' : 'Remove admin rights from';
    if (window.confirm(`${verb} ${u.username}${role === 'admin' ? ' an admin' : ''}?`)) {
      void act(() => api.updateUser(u.id, { role }));
    }
  }

  function remove(u: UserSummary) {
    const ok = window.confirm(
      `Delete ${u.username}? This permanently deletes their ${u.fileCount} file(s) — including ` +
        `the copies stored on their connected drives — and disconnects their ` +
        `${u.backendCount} backend(s).`,
    );
    if (ok) void act(() => api.deleteUser(u.id));
  }

  return (
    <div className="card">
      <h3>Users</h3>
      <p className="muted small">
        Each user has a private file tree and pools only the drives they connect themselves (plus
        any local disk you allocate to them on the Storage page).
      </p>

      {error && <div className="error">{error}</div>}

      <div className="table-scroll">
        <table className="user-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Files</th>
              <th>Backends</th>
              <th>Capacity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.username === currentUsername;
              return (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    {self && <span className="muted"> (you)</span>}
                  </td>
                  <td>{u.role === 'admin' ? 'Admin' : 'User'}</td>
                  <td>
                    {u.fileCount} · {formatBytes(u.usedBytes)}
                  </td>
                  <td>{u.backendCount}</td>
                  <td>{formatBytes(u.capacity)}</td>
                  <td>
                    <div className="actions">
                      <button className="mini" onClick={() => resetPassword(u)}>
                        Reset password
                      </button>
                      {!self && (
                        <>
                          <button className="mini" onClick={() => toggleRole(u)}>
                            {u.role === 'admin' ? 'Make user' : 'Make admin'}
                          </button>
                          <button className="mini danger" onClick={() => remove(u)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 22 }}>Add a user</h3>
      <form className="user-form" onSubmit={create}>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button className="primary" disabled={busy} type="submit">
          {busy ? 'Adding…' : 'Add user'}
        </button>
      </form>
    </div>
  );
}
