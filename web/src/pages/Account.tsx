import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Role, type Settings, type UserSummary } from '../api';
import { formatBytes } from '../format';
import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  PromptDialog,
  Select,
  Switch,
  Toast,
  type ToastMessage,
} from '../components/ui';

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
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  return (
    <div className="page">
      <div className="page-intro">
        <h1 className="h1">Account</h1>
        <p className="body">
          Signed in as <strong>{username}</strong>
          {isAdmin ? ' (admin)' : ''}. Your files and drives are private to your account.
        </p>
      </div>

      <div className="form-grid">
        <ChangePassword />
        <div className="card">
          <div className="card-head">
            <h3 className="h3">Map as a network drive</h3>
            <p className="body-s">
              Use this WebDAV address in Windows, macOS, rclone or any WebDAV client, signing in
              with your own username and password. You will see only your own files.
            </p>
          </div>
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
      {isAdmin && <Users key={settingsVersion} currentUsername={username} onToast={setToast} />}

      {toast && <Toast message={toast} onDone={dismissToast} />}
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next !== confirm) return setConfirmError('The new passwords do not match.');
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
    <form className="card" onSubmit={submit} noValidate>
      <h3 className="h3">Change password</h3>
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          setConfirmError('');
        }}
        error={confirmError}
      />
      {error && <div className="banner-error">{error}</div>}
      {done && <div className="banner-success">Password changed.</div>}
      <div>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}

/** Admin-only: switches that apply to every user. */
function SiteSettings({ onChange }: { onChange: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    api.settings().then(setSettings, (err) => setError(errorMessage(err)));
  }, []);

  async function setLocal(next: boolean) {
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
      <h3 className="h3">Site settings</h3>
      {error && <div className="banner-error">{error}</div>}
      {settings && (
        <div className="setting-row">
          <div className="card-head">
            <strong>Local disk storage</strong>
            <p className="body-s">
              Lets admins allocate space on this server's disk to users. Turn it off to have
              everyone store files only on the cloud drives they connect.
            </p>
          </div>
          <Switch
            checked={settings.localStorageEnabled}
            disabled={busy}
            label={settings.localStorageEnabled ? 'On' : 'Off'}
            onChange={() =>
              settings.localStorageEnabled ? setConfirmOff(true) : void setLocal(true)
            }
          />
        </div>
      )}
      {confirmOff && (
        <ConfirmDialog
          title="Turn off local disk storage?"
          body="Existing local disks stop taking new uploads and leave every user’s pool. Files already on them stay readable, so they can be moved or deleted."
          action="Turn off"
          onClose={() => setConfirmOff(false)}
          onConfirm={async () => {
            setConfirmOff(false);
            await setLocal(false);
          }}
        />
      )}
    </div>
  );
}

type UserDialog =
  | { kind: 'password'; user: UserSummary }
  | { kind: 'role'; user: UserSummary }
  | { kind: 'delete'; user: UserSummary };

/** Admin-only: create accounts, reset passwords, change roles, delete accounts. */
function Users({
  currentUsername,
  onToast,
}: {
  currentUsername: string;
  onToast: (message: ToastMessage) => void;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<UserDialog | null>(null);

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
      const name = username.trim();
      await api.createUser(name, password, role);
      setUsername('');
      setPassword('');
      setRole('user');
      await load();
      onToast({ text: `Added ${name}` });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Run a change from a dialog, then refresh; failures surface as a toast. */
  async function act(action: () => Promise<unknown>, done: string) {
    setDialog(null);
    try {
      await action();
      await load();
      onToast({ text: done });
    } catch (err) {
      onToast({ text: errorMessage(err), tone: 'danger' });
    }
  }

  const promoting = dialog?.kind === 'role' && dialog.user.role !== 'admin';

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="h3">Users</h3>
        <p className="body-s">
          Each user has a private file tree and pools only the drives they connect themselves
          (plus any local disk you allocate to them on the Storage page).
        </p>
      </div>

      {error && <div className="banner-error">{error}</div>}

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
                  <td>
                    <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>{u.role}</Badge>
                  </td>
                  <td className="num">
                    {u.fileCount} · {formatBytes(u.usedBytes)}
                  </td>
                  <td className="num">{u.backendCount}</td>
                  <td className="num">{formatBytes(u.capacity)}</td>
                  <td>
                    <div className="actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: 'password', user: u })}
                      >
                        Reset password
                      </Button>
                      {!self && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDialog({ kind: 'role', user: u })}
                          >
                            {u.role === 'admin' ? 'Make user' : 'Make admin'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDialog({ kind: 'delete', user: u })}
                          >
                            Delete
                          </Button>
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

      <form className="user-form" onSubmit={create} noValidate>
        <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </Select>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add user'}
        </Button>
      </form>

      {dialog?.kind === 'password' && (
        <PromptDialog
          title="Reset password"
          label={`New password for ${dialog.user.username}`}
          type="password"
          hint="At least 8 characters"
          action="Save"
          onClose={() => setDialog(null)}
          onSubmit={async (next) => {
            await api.updateUser(dialog.user.id, { password: next });
            setDialog(null);
            onToast({ text: `Password reset for ${dialog.user.username}` });
          }}
        />
      )}
      {dialog?.kind === 'role' && (
        <ConfirmDialog
          title={promoting ? `Make ${dialog.user.username} an admin?` : `Make ${dialog.user.username} a user?`}
          body={
            promoting
              ? 'Admins can manage every account, allocate local disk and change site settings.'
              : 'They keep their files and drives but can no longer manage accounts or settings.'
          }
          action={promoting ? 'Make admin' : 'Make user'}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            act(
              () => api.updateUser(dialog.user.id, { role: promoting ? 'admin' : 'user' }),
              `${dialog.user.username} is now ${promoting ? 'an admin' : 'a user'}`,
            )
          }
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${dialog.user.username}?`}
          body={`This permanently deletes their ${dialog.user.fileCount} file${
            dialog.user.fileCount === 1 ? '' : 's'
          }, including the copies stored on their connected drives, and disconnects their ${
            dialog.user.backendCount
          } backend${dialog.user.backendCount === 1 ? '' : 's'}.`}
          action="Delete"
          onClose={() => setDialog(null)}
          onConfirm={() => act(() => api.deleteUser(dialog.user.id), `Deleted ${dialog.user.username}`)}
        />
      )}
    </div>
  );
}
