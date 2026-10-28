import { useCallback, useEffect, useState } from 'react';
import { api, type NodeDto, type Role, type Usage } from './api';
import { formatBytes, usedPercent } from './format';
import { Login } from './pages/Login';
import { Files } from './pages/Files';
import { Admin } from './pages/Admin';
import { Account } from './pages/Account';
import { Wordmark } from './components/Wordmark';
import { backendColor } from './backends';
import {
  MenuIcon,
  FolderIcon,
  DatabaseIcon,
  SearchIcon,
  SignOutIcon,
  UserIcon,
} from './components/Icons';

type Auth = 'loading' | 'in' | 'out';
type View = 'files' | 'admin' | 'account';

export default function App() {
  const [auth, setAuth] = useState<Auth>('loading');
  const [view, setView] = useState<View>('files');
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('cs.sidebar') === 'collapsed',
  );
  const [usage, setUsage] = useState<Usage | null>(null);
  const [quickFolders, setQuickFolders] = useState<NodeDto[]>([]);
  // The left pane's folder lives here so the sidebar's quick access can navigate it.
  const [filesFolder, setFilesFolder] = useState('root');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [signupEnabled, setSignupEnabled] = useState(false);

  /** Who is signed in (if anyone). Re-run after sign-in so the shell shows the right account. */
  const loadMe = useCallback(() => {
    api
      .me()
      .then((r) => {
        setUsername(r.username ?? '');
        setRole(r.role);
        setSignupEnabled(r.signupEnabled);
        setAuth(r.authenticated ? 'in' : 'out');
      })
      .catch(() => setAuth('out'));
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  /** Sidebar data: the combined pool and the root's folders for quick access. */
  const loadShell = useCallback(async () => {
    if (auth !== 'in') return;
    try {
      const [u, root] = await Promise.all([api.storage(), api.list('root')]);
      setUsage(u);
      setQuickFolders(root.children.filter((c) => c.type === 'folder'));
    } catch {
      /* the shell degrades quietly; the pages report their own errors */
    }
  }, [auth]);

  useEffect(() => {
    loadShell();
  }, [loadShell]);

  function toggleSidebar() {
    setCollapsed((prev) => {
      localStorage.setItem('cs.sidebar', prev ? 'expanded' : 'collapsed');
      return !prev;
    });
  }

  if (auth === 'loading') return <div className="center">Loading…</div>;
  if (auth === 'out') {
    return (
      <Login
        signupEnabled={signupEnabled}
        onLogin={() => {
          // A different account may sign in than last time: start from its own root.
          setView('files');
          setFilesFolder('root');
          setUsage(null);
          setQuickFolders([]);
          loadMe();
        }}
      />
    );
  }

  const pct = usage ? usedPercent(usage.used, usage.total) : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Wordmark />
        </div>

        <div className="topbar-right">
          {usage && (
            <div className="pool-chip" title={`${formatBytes(usage.used)} of ${formatBytes(usage.total)}`}>
              <span className="label">Pool</span>
              <span className="track">
                <span className="fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="value">{pct}%</span>
            </div>
          )}
          <div className="topbar-icons">
            {/* The design calls for a search control; there is no search API yet, so it is
                shown disabled rather than as a button that silently does nothing. */}
            <button
              className="icon-btn"
              title="Search is not available yet"
              aria-label="Search (not available yet)"
              disabled
            >
              <SearchIcon />
            </button>
            <button
              className="icon-btn"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                await api.logout();
                setAuth('out');
              }}
            >
              <SignOutIcon />
            </button>
          </div>
          <button
            className="avatar"
            title={`Signed in as ${username}`}
            aria-label={`Account (${username})`}
            onClick={() => setView('account')}
          >
            {username.charAt(0).toUpperCase()}
          </button>
        </div>
      </header>

      <div className="shell">
        <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
          <button
            className="hamburger"
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <MenuIcon />
          </button>

          <nav className="nav">
            <button
              className={`nav-item${view === 'files' ? ' active' : ''}`}
              onClick={() => setView('files')}
              title="Files"
            >
              <FolderIcon size={19} />
              <span>Files</span>
            </button>
            <button
              className={`nav-item${view === 'admin' ? ' active' : ''}`}
              onClick={() => setView('admin')}
              title="Storage"
            >
              <DatabaseIcon size={19} />
              <span>Storage</span>
            </button>
            <button
              className={`nav-item${view === 'account' ? ' active' : ''}`}
              onClick={() => setView('account')}
              title={role === 'admin' ? 'Account & users' : 'Account'}
            >
              <UserIcon size={19} />
              <span>{role === 'admin' ? 'Account & users' : 'Account'}</span>
            </button>
          </nav>

          <div className="side-scroll">
            <div className="side-head">
              <span className="title">Quick access</span>
              <button onClick={() => setFilesFolder('root')}>Root</button>
            </div>
            {quickFolders.length === 0 ? (
              <div className="quick-row empty">
                <span className="name">No folders yet</span>
              </div>
            ) : (
              quickFolders.map((f) => (
                <button
                  key={f.id}
                  className={`quick-row${filesFolder === f.id ? ' active' : ''}`}
                  onClick={() => {
                    setView('files');
                    setFilesFolder(f.id);
                  }}
                  title={f.name}
                >
                  <FolderIcon size={15} />
                  <span className="name">{f.name}</span>
                </button>
              ))
            )}

            {usage && usage.backends.length > 0 && (
              <>
                <div className="side-head spaced">
                  <span className="title">Backends</span>
                </div>
                {usage.backends.map((b) => {
                  const bp = usedPercent(b.used, b.total);
                  const colour = b.status === 'error' ? 'var(--danger)' : backendColor(b.type);
                  return (
                    <div key={b.id} className="side-backend">
                      <div className="row">
                        <span className="dot" style={{ background: colour }} />
                        <span className="name" title={b.name}>
                          {b.name}
                        </span>
                        <span className="pct">{bp}%</span>
                      </div>
                      <div className="track">
                        <div
                          className="fill"
                          style={{ width: `${bp}%`, background: bp >= 90 ? 'var(--danger)' : colour }}
                        />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </aside>

        <main>
          <div className="content-inner">
            {view === 'files' ? (
              <Files
                folderId={filesFolder}
                onFolderChange={setFilesFolder}
                onDataChange={loadShell}
              />
            ) : view === 'admin' ? (
              <Admin onDataChange={loadShell} isAdmin={role === 'admin'} username={username} />
            ) : (
              <Account username={username} isAdmin={role === 'admin'} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
