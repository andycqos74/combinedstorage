import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Wordmark } from '../components/Wordmark';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(username, password);
      onLogin();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-brand">
        <Wordmark />
      </div>

      <form className="card login" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted">Manage your files and storage backends.</p>

        <div className="login-fields">
          <label>
            Username
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="admin password"
            />
          </label>
        </div>

        {error && <div className="error">{error}</div>}

        <button className="primary" disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
