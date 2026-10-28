import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Wordmark } from '../components/Wordmark';

export function Login({ onLogin, signupEnabled }: { onLogin: () => void; signupEnabled: boolean }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signingUp = mode === 'signup';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (signingUp && password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (signingUp) await api.register(username, password);
      else await api.login(username, password);
      onLogin();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(signingUp ? 'signin' : 'signup');
    setError('');
    setConfirm('');
  }

  return (
    <div className="login-wrap">
      <div className="login-brand">
        <Wordmark />
      </div>

      <form className="card login" onSubmit={submit}>
        <h1>{signingUp ? 'Create an account' : 'Sign in'}</h1>
        <p className="muted">
          {signingUp
            ? 'Then connect your own drives to build your storage pool.'
            : 'Manage your files and storage backends.'}
        </p>

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
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={signingUp ? 'At least 8 characters' : undefined}
            />
          </label>
          {signingUp && (
            <label>
              Confirm password
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <button className="primary" disabled={busy} type="submit">
          {signingUp ? (busy ? 'Creating…' : 'Create account') : busy ? 'Signing in…' : 'Sign in'}
        </button>

        {signupEnabled && (
          <p className="muted login-switch">
            {signingUp ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" className="link" onClick={switchMode}>
              {signingUp ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
