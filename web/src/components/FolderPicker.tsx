import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type Crumb, type NodeDto } from '../api';
import { FolderIcon } from './Icons';
import { Button, Dialog } from './ui';

/**
 * Dialog folder browser used to pick a destination for move/copy. Only folders are listed —
 * files are irrelevant as destinations — and the items being moved are left out, so a folder
 * cannot be picked as its own destination.
 */
export function FolderPicker({
  title,
  actionLabel,
  excludeIds,
  onChoose,
  onCancel,
}: {
  title: string;
  actionLabel: string;
  excludeIds?: Set<string>;
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
      setFolders(data.children.filter((c) => c.type === 'folder' && !excludeIds?.has(c.id)));
      setBreadcrumb(data.breadcrumb);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [folderId, excludeIds]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Dialog title={title} onClose={onCancel} width={480}>
      <div className="dialog-body">
        <nav className="crumbs">
          {breadcrumb.map((c, i, arr) => (
            <span key={c.id} className="crumb-step">
              <button
                className={`crumb${i === arr.length - 1 ? ' current' : ''}`}
                onClick={() => setFolderId(c.id)}
              >
                {c.name}
              </button>
              {i < arr.length - 1 && <span className="crumb-sep">/</span>}
            </span>
          ))}
        </nav>

        {error && <div className="banner-error">{error}</div>}

        <div className="picker-list">
          {folders.length === 0 ? (
            <span className="picker-empty">No subfolders here.</span>
          ) : (
            folders.map((f) => (
              <button key={f.id} className="picker-row" onClick={() => setFolderId(f.id)}>
                <span className="chip chip-sm folder">
                  <FolderIcon size={14} />
                </span>
                {f.name}
              </button>
            ))
          )}
        </div>

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onChoose(folderId)}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
