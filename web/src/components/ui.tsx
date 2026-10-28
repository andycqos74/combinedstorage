import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { CloseIcon } from './Icons';

/**
 * The SolwAI primitive set the screens are built from. Every visual value comes from the design
 * tokens in styles/*.css via the classes in styles.css; components only choose variants.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: Size;
  fullWidth?: boolean;
}) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', fullWidth && 'btn-full', className)}
      {...rest}
    />
  );
}

/** Square icon-only button. `label` is required: it becomes the aria-label and tooltip. */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string;
  variant?: 'ghost' | 'secondary';
  size?: Size;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('icon-btn', `btn-${variant}`, size === 'sm' && 'icon-btn-sm', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  hint,
  error,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cx('field', className)}>
      {label && (
        <label className="field-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cx('input', !!error && 'input-error')}
        aria-invalid={!!error || undefined}
        {...rest}
      />
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** Same label/hint chrome as Input, around a native select. */
export function Select({
  label,
  className,
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode }) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cx('field', className)}>
      {label && (
        <label className="field-label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select id={selectId} className="input select" {...rest}>
        {children}
      </select>
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'aria-label'> & { label: string }) {
  return (
    <input
      type="checkbox"
      className="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      {...rest}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cx('switch', disabled && 'switch-disabled')}>
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </label>
  );
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Modal dialog: navy scrim, white panel, C64 title and a close ×. Escape and scrim click close. */
export function Dialog({
  title,
  onClose,
  width = 440,
  children,
  className,
}: {
  title: ReactNode;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('dialog', className)}
        style={{ width, maxWidth: 'calc(100vw - 36px)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <CloseIcon size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface ToastMessage {
  text: string;
  tone?: Tone;
}

/** Bottom-right status card with a tide-line marker in the tone colour. Auto-dismisses. */
export function Toast({
  message,
  onDone,
  duration,
}: {
  message: ToastMessage;
  onDone: () => void;
  duration?: number;
}) {
  const tone = message.tone ?? 'success';
  // Errors usually carry a sentence worth reading, so they stay up longer.
  const ms = duration ?? (tone === 'danger' ? 6000 : 2400);
  useEffect(() => {
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [message, ms, onDone]);

  return (
    <div className="toast-wrap" role={tone === 'danger' ? 'alert' : 'status'}>
      <div className={`toast toast-${tone}`}>
        <span className="toast-marker" aria-hidden="true" />
        <span className="toast-text">{message.text}</span>
        <IconButton label="Dismiss" size="sm" onClick={onDone}>
          <CloseIcon size={14} />
        </IconButton>
      </div>
    </div>
  );
}

/** Mono uppercase label, e.g. "QUICK ACCESS". */
export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('mono-label', className)}>{children}</span>;
}

/** One-input dialog used for rename, new folder, friendly link and password resets. */
export function PromptDialog({
  title,
  label,
  initial = '',
  action,
  hint,
  type = 'text',
  onSubmit,
  onClose,
  extraAction,
}: {
  title: string;
  label: string;
  initial?: string;
  action: string;
  /** Static hint, or one computed from the current value. */
  hint?: ReactNode | ((value: string) => ReactNode);
  type?: string;
  /** Resolve to close; throw to show the message under the input and keep the dialog open. */
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
  extraAction?: { label: string; run: () => Promise<void> | void };
}) {
  const [value, setValue] = useState(initial ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void> | void) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setError(`Enter a ${label.toLowerCase()}.`);
      return;
    }
    void run(() => onSubmit(value.trim()));
  }

  return (
    <Dialog title={title} onClose={onClose} width={440}>
      <form className="dialog-body" onSubmit={submit}>
        <Input
          label={label}
          type={type}
          value={value}
          autoFocus
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          hint={typeof hint === 'function' ? hint(value) : hint}
          error={error}
        />
        <div className="dialog-actions split">
          <div>
            {extraAction && (
              <Button variant="ghost" disabled={busy} onClick={() => void run(extraAction.run)}>
                {extraAction.label}
              </Button>
            )}
          </div>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {action}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** Destructive confirmation: body text, Cancel and a danger action. */
export function ConfirmDialog({
  title,
  body,
  action,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  action: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose} width={440}>
      <div className="dialog-body loose">
        <p className="dialog-text">{body}</p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {action}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
