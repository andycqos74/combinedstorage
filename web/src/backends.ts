import type { Tone } from './components/ui';

/**
 * Per-backend colour, shared by the sidebar meters, the storage legend, the "Stored on" badges
 * and the backend cards so a backend reads as the same colour everywhere. Values are design
 * tokens; the on-navy set is for the inverse (navy) total card.
 */
const COLOURS: Record<string, string> = {
  local: 'var(--navy)',
  onedrive: 'var(--solwai-accent)',
  googledrive: 'var(--luggage-accent)',
};

const COLOURS_ON_NAVY: Record<string, string> = {
  local: 'var(--white)',
  onedrive: 'var(--solwai-accent-on-navy)',
  googledrive: 'var(--luggage-accent-on-navy)',
};

const TONES: Record<string, Tone> = {
  local: 'neutral',
  onedrive: 'info',
  googledrive: 'success',
};

export function backendColor(type: string): string {
  return COLOURS[type] ?? 'var(--slate-400)';
}

export function backendColorOnNavy(type: string): string {
  return COLOURS_ON_NAVY[type] ?? 'var(--slate-on-navy)';
}

/** Badge tone for a backend type. */
export function backendTone(type: string): Tone {
  return TONES[type] ?? 'neutral';
}

/** Human label for a backend type. */
export function backendLabel(type: string): string {
  if (type === 'googledrive') return 'google';
  return type;
}
