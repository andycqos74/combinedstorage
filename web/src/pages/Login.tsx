import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Wordmark } from '../components/Wordmark';
import { Button, Input, MonoLabel } from '../components/ui';

export function Login({ onLogin, signupEnabled }: { onLogin: () => void; signupEnabled: boolean }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signingUp = mode === 'signup';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return setPasswordError('Enter your password.');
    if (signingUp && password !== confirm) return setConfirmError('The passwords do not match.');
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
    setPasswordError('');
    setConfirmError('');
    setConfirm('');
  }

  return (
    <div className="signin">
      <Wordmark size={0.9} />

      <form className="signin-card" onSubmit={submit} noValidate>
        <div className="signin-head">
          <h1 className="h2">{signingUp ? 'Create an account' : 'Sign in'}</h1>
          <p className="body">
            {signingUp
              ? 'Then connect your own drives to build your storage pool.'
              : 'Manage your files and storage backends.'}
          </p>
        </div>

        <div className="signin-fields">
          <Input
            label="Username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            value={password}
            placeholder={signingUp ? 'At least 8 characters' : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError('');
            }}
            error={passwordError}
          />
          {signingUp && (
            <Input
              label="Confirm password"
              type="password"
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setConfirmError('');
              }}
              error={confirmError}
            />
          )}
        </div>

        {error && <div className="banner-error">{error}</div>}

        <Button variant="primary" type="submit" fullWidth disabled={busy}>
          {signingUp ? (busy ? 'Creating…' : 'Create account') : busy ? 'Signing in…' : 'Sign in'}
        </Button>

        {signupEnabled && (
          <p className="signin-switch body-s">
            {signingUp ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" className="text-btn" onClick={switchMode}>
              {signingUp ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        )}
      </form>

      <MonoLabel>Combined storage · self-hosted</MonoLabel>
    </div>
  );
}
