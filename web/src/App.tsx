import { useCallback, useEffect, useState } from 'react';
import { api, type NodeDto, type Role, type Usage } from './api';
import { formatBytes, usedPercent } from './format';
import { Login } from './pages/Login';
import { Files } from './pages/Files';
import { Admin } from './pages/Admin';
import { Account } from './pages/Account';
import { Wordmark } from './components/Wordmark';
import { backendColor } from './backends';
import { IconButton, MonoLabel } from './components/ui';
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

  if (auth === 'loading') return <div className="center-screen">Loading…</div>;
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
  const isAdmin = role === 'admin';
  const navItems: { view: View; label: string; icon: JSX.Element }[] = [
    { view: 'files', label: 'Files', icon: <FolderIcon size={19} /> },
    { view: 'admin', label: 'Storage', icon: <DatabaseIcon size={19} /> },
    { view: 'account', label: isAdmin ? 'Account & users' : 'Account', icon: <UserIcon size={19} /> },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <Wordmark size={0.6} />

        <div className="topbar-right">
          {usage && (
            <div
              className="pool"
              title={`${formatBytes(usage.used)} of ${formatBytes(usage.total)}`}
            >
              <MonoLabel>Pool</MonoLabel>
              <span className="pool-track">
                <span className="pool-fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="pool-value">{pct}%</span>
            </div>
          )}
          <span className="vdivider" />
          <div className="topbar-icons">
            {/* There is no search API yet, so the control is shown disabled rather than as a
                button that silently does nothing. */}
            <IconButton label="Search is not available yet" disabled className="topbar-search">
              <SearchIcon />
            </IconButton>
            <IconButton
              label="Sign out"
              onClick={async () => {
                await api.logout();
                setAuth('out');
              }}
            >
              <SignOutIcon />
            </IconButton>
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
          <IconButton label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}>
            <MenuIcon />
          </IconButton>

          <nav className="nav">
            {navItems.map((item) => (
              <button
                key={item.view}
                className={`nav-item${view === item.view ? ' active' : ''}`}
                onClick={() => setView(item.view)}
                title={item.label}
                aria-current={view === item.view ? 'page' : undefined}
              >
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
              </button>
            ))}
          </nav>

          {!collapsed && (
            <div className="side-scroll">
              <div className="side-group">
                <div className="side-head">
                  <MonoLabel>Quick access</MonoLabel>
                  <button
                    className="text-btn"
                    onClick={() => {
                      setView('files');
                      setFilesFolder('root');
                    }}
                  >
                    Root
                  </button>
                </div>
                {quickFolders.length === 0 ? (
                  <span className="quick-empty">No folders yet</span>
                ) : (
                  quickFolders.map((f) => (
                    <button
                      key={f.id}
                      className={`quick-row${view === 'files' && filesFolder === f.id ? ' active' : ''}`}
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
              </div>

              {usage && usage.backends.length > 0 && (
                <div className="side-backends">
                  <MonoLabel>Backends</MonoLabel>
                  {usage.backends.map((b) => {
                    const bp = usedPercent(b.used, b.total);
                    return (
                      <div key={b.id} className="side-backend">
                        <div className="side-backend-row">
                          <span
                            className="dot"
                            style={{
                              background: b.status === 'error' ? 'var(--danger)' : backendColor(b.type),
                            }}
                          />
                          <span className="side-backend-name ellipsis" title={b.name}>
                            {b.name}
                          </span>
                          <span className="mono-meta">{bp}%</span>
                        </div>
                        <div className="bar">
                          <div
                            className={`bar-fill${bp >= 90 ? ' danger' : ''}`}
                            style={{ width: `${bp}%`, ...(bp < 90 && { background: backendColor(b.type) }) }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </aside>

        <main>
          <div className="content">
            {view === 'files' ? (
              <Files
                folderId={filesFolder}
                onFolderChange={setFilesFolder}
                onDataChange={loadShell}
              />
            ) : view === 'admin' ? (
              <Admin onDataChange={loadShell} isAdmin={isAdmin} username={username} />
            ) : (
              <Account username={username} isAdmin={isAdmin} onDataChange={loadShell} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
