import { useEffect, useState } from 'react';
import { api } from './api';
import { Login } from './pages/Login';
import { Files } from './pages/Files';
import { Admin } from './pages/Admin';

type Auth = 'loading' | 'in' | 'out';
type View = 'files' | 'admin';

export default function App() {
  const [auth, setAuth] = useState<Auth>('loading');
  const [view, setView] = useState<View>('files');

  useEffect(() => {
    api
      .me()
      .then((r) => setAuth(r.authenticated ? 'in' : 'out'))
      .catch(() => setAuth('out'));
  }, []);

  if (auth === 'loading') {
    return <div className="center muted">Loading…</div>;
  }
  if (auth === 'out') {
    return <Login onLogin={() => setAuth('in')} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> Combined Storage
        </div>
        <nav className="tabs">
          <button className={view === 'files' ? 'active' : ''} onClick={() => setView('files')}>
            Files
          </button>
          <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
            Storage
          </button>
        </nav>
        <button
          className="link"
          onClick={async () => {
            await api.logout();
            setAuth('out');
          }}
        >
          Sign out
        </button>
      </header>
      <main>{view === 'files' ? <Files /> : <Admin />}</main>
    </div>
  );
}
