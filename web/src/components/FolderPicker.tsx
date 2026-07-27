import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type Crumb, type NodeDto } from '../api';

/**
 * Modal folder browser used to pick a destination for move/copy. Only folders are listed —
 * files are irrelevant as destinations.
 */
export function FolderPicker({
  title,
  actionLabel,
  onChoose,
  onCancel,
}: {
  title: string;
  actionLabel: string;
  onChoose: (folderId: string) => void;
  onCancel: () => void;
}) {
  const [folderId, setFolderId] = useState('root');
  const [folders, setFolders] = useState<NodeDto[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.list(folderId);
      setFolders(data.children.filter((c) => c.type === 'folder'));
      setBreadcrumb(data.breadcrumb);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [folderId]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>

        <nav className="crumbs">
          {breadcrumb.map((c, i, arr) => (
            <span key={c.id}>
              <button className="crumb" onClick={() => setFolderId(c.id)}>
                {c.name}
              </button>
              {i < arr.length - 1 && <span className="sep">/</span>}
            </span>
          ))}
        </nav>

        {error && <div className="error">{error}</div>}

        <div className="picker-list">
          {folders.length === 0 ? (
            <div className="muted small picker-empty">No subfolders here.</div>
          ) : (
            folders.map((f) => (
              <button key={f.id} className="picker-row" onClick={() => setFolderId(f.id)}>
                <span className="icon">📁</span> {f.name}
              </button>
            ))
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onChoose(folderId)}>
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
