/**
 * Per-backend colour, shared by the sidebar meters, the storage legend, the "Stored on" pills
 * and the backend cards so a backend reads as the same colour everywhere.
 */
const COLOURS: Record<string, string> = {
  local: '#1857C4',
  onedrive: '#2A86F5',
  googledrive: '#0F9B6C',
};

export function backendColor(type: string): string {
  return COLOURS[type] ?? '#5B6B87';
}

/** Human label for a backend type. */
export function backendLabel(type: string): string {
  if (type === 'googledrive') return 'google';
  return type;
}

/**
 * Pill styling derived from the backend colour: text in the colour, background at 8% and
 * border at 20% (the hex suffixes the design handoff specifies).
 */
export function backendPillStyle(type: string): React.CSSProperties {
  const c = backendColor(type);
  return { color: c, background: `${c}14`, border: `1px solid ${c}33` };
}
