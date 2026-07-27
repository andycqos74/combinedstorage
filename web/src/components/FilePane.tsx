import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type DragEvent,
} from 'react';
import ReactDOM from 'react-dom';
import { api, errorMessage, type ListResponse, type NodeDto } from '../api';
import { formatBytes } from '../format';
import { PreviewModal, isEditableImage } from './PreviewModal';

// The image editor pulls in a large canvas library, so it is code-split: browsing the file list
// never downloads it, and it is fetched the first time someone opens an image for editing.
//
// Filerobot's published build references a bare `React` global (classic JSX runtime), which an
// ESM bundle does not provide — so publish it on window before that module is evaluated.
const ImageEditorModal = lazy(async () => {
  const w = window as unknown as Record<string, unknown>;
  w.React = React;
  w.ReactDOM = ReactDOM;
  const m = await import('./ImageEditorModal');
  return { default: m.ImageEditorModal };
});

/** Payload carried by an internal drag (files/folders moving within the app). */
export interface DragPayload {
  ids: string[];
  sourceFolderId: string;
}

export const DRAG_MIME = 'application/x-combinedstorage-nodes';

interface UploadItem {
  id: string;
  name: string;
  pct: number;
  error?: string;
}

export interface FilePaneHandle {
  reload: () => void;
}

export function FilePane({
  folderId,
  onNavigate,
  selected,
  onSelectedChange,
  onDropNodes,
  onAfterChange,
  registerReload,
  title,
  compact,
}: {
  folderId: string;
  onNavigate: (id: string) => void;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Called when nodes are dropped onto a folder in this pane (or its background). */
  onDropNodes: (payload: DragPayload, destFolderId: string, copy: boolean) => void;
  /** Called after this pane changes data (upload, new folder, rename…) so siblings refresh. */
  onAfterChange: () => void;
  registerReload?: (reload: () => void) => void;
  title?: string;
  compact?: boolean;
}) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // node id, or '' for the pane
  const [copied, setCopied] = useState('');
  const [preview, setPreview] = useState<NodeDto | null>(null);
  const [editing, setEditing] = useState<NodeDto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastClicked = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.list(folderId));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [folderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    registerReload?.(load);
  }, [registerReload, load]);

  const children = data?.children ?? [];

  // ---- selection ----------------------------------------------------------

  function toggle(node: NodeDto, e: React.MouseEvent | React.ChangeEvent) {
    const next = new Set(selected);
    const shift = 'shiftKey' in e && (e as React.MouseEvent).shiftKey;

    if (shift && lastClicked.current) {
      // Select the contiguous range between the previous click and this one.
      const ids = children.map((c) => c.id);
      const from = ids.indexOf(lastClicked.current);
      const to = ids.indexOf(node.id);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
        onSelectedChange(next);
        return;
      }
    }

    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    lastClicked.current = node.id;
    onSelectedChange(next);
  }

  const allSelected = children.length > 0 && children.every((c) => selected.has(c.id));
  function toggleAll() {
    const next = new Set(selected);
    if (allSelected) children.forEach((c) => next.delete(c.id));
    else children.forEach((c) => next.add(c.id));
    onSelectedChange(next);
  }

  // ---- drag and drop ------------------------------------------------------

  function onDragStart(e: DragEvent, node: NodeDto) {
    // Dragging an unselected row drags just that row; otherwise drag the whole selection.
    const ids = selected.has(node.id) ? Array.from(selected) : [node.id];
    const payload: DragPayload = { ids, sourceFolderId: folderId };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copyMove';
  }

  function isInternalDrag(e: DragEvent): boolean {
    return e.dataTransfer.types.includes(DRAG_MIME);
  }

  function onDragOverTarget(e: DragEvent, targetId: string) {
    if (!isInternalDrag(e) && e.dataTransfer.types.includes('Files')) {
      e.preventDefault(); // external file upload
      setDropTarget(targetId);
      return;
    }
    if (!isInternalDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    setDropTarget(targetId);
  }

  function onDropTarget(e: DragEvent, destFolderId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);

    if (isInternalDrag(e)) {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      const payload = JSON.parse(raw) as DragPayload;
      onDropNodes(payload, destFolderId, e.ctrlKey || e.metaKey);
      return;
    }
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files, destFolderId);
  }

  // ---- actions ------------------------------------------------------------

  async function uploadFiles(fileList: FileList | File[], destFolderId = folderId) {
    for (const file of Array.from(fileList)) {
      const item: UploadItem = { id: crypto.randomUUID(), name: file.name, pct: 0 };
      setUploads((prev) => [...prev, item]);
      try {
        await api.upload(destFolderId, file, (f) =>
          setUploads((prev) =>
            prev.map((u) => (u.id === item.id ? { ...u, pct: Math.round(f * 100) } : u)),
          ),
        );
        setUploads((prev) => prev.filter((u) => u.id !== item.id));
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) => (u.id === item.id ? { ...u, error: errorMessage(err) } : u)),
        );
      }
    }
    await load();
    onAfterChange();
  }

  async function newFolder() {
    const name = window.prompt('New folder name:');
    if (!name) return;
    try {
      await api.createFolder(folderId, name);
      await load();
      onAfterChange();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function rename(node: NodeDto) {
    const name = window.prompt('Rename to:', node.name);
    if (!name || name === node.name) return;
    try {
      await api.rename(node.id, name);
      await load();
      onAfterChange();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function editAlias(node: NodeDto) {
    let prefill = node.alias ?? '';
    if (!prefill) {
      try {
        prefill = (await api.suggestAlias(node.id)).suggestion;
      } catch {
        /* fall back to empty */
      }
    }
    const input = window.prompt(
      `Friendly link for "${node.name}".\nEdit the path, or clear it to remove the friendly link:`,
      prefill,
    );
    if (input === null) return;
    try {
      if (input.trim() === '') {
        if (node.alias) await api.clearAlias(node.id);
      } else {
        await api.setAlias(node.id, input.trim());
      }
      await load();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function copyLink(node: NodeDto) {
    const link = node.aliasUrl ?? node.url;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('Copy this link:', link);
    }
    setCopied(node.id);
    setTimeout(() => setCopied(''), 1200);
  }

  return (
    <div className="pane">
      <div className="toolbar">
        {title && <span className="pane-title">{title}</span>}
        <nav className="crumbs">
          {(data?.breadcrumb ?? []).map((c, i, arr) => (
            <span key={c.id}>
              <button
                className={`crumb${dropTarget === `crumb:${c.id}` ? ' droptarget' : ''}`}
                onClick={() => onNavigate(c.id)}
                onDragOver={(e) => onDragOverTarget(e, `crumb:${c.id}`)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => onDropTarget(e, c.id)}
              >
                {c.name}
              </button>
              {i < arr.length - 1 && <span className="sep">/</span>}
            </span>
          ))}
        </nav>
        <div className="actions">
          <button onClick={newFolder}>New folder</button>
          <button className="primary" onClick={() => inputRef.current?.click()}>
            Upload
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {uploads.length > 0 && (
        <div className="uploads">
          {uploads.map((u) => (
            <div key={u.id} className="upload-row">
              <span className="name">{u.name}</span>
              {u.error ? (
                <span className="error-inline">{u.error}</span>
              ) : (
                <span className="progress">
                  <span className="progress-fill" style={{ width: `${u.pct}%` }} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        className={`filelist${dropTarget === '' ? ' dragover' : ''}`}
        onDragOver={(e) => onDragOverTarget(e, '')}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => onDropTarget(e, folderId)}
      >
        {children.length === 0 ? (
          <div className="empty">This folder is empty. Drop files here or use Upload.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th>Name</th>
                <th className="col-size">Size</th>
                {!compact && <th className="col-actions">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {children.map((node) => (
                <tr
                  key={node.id}
                  className={
                    (selected.has(node.id) ? 'selected' : '') +
                    (dropTarget === node.id ? ' droptarget' : '')
                  }
                  draggable
                  onDragStart={(e) => onDragStart(e, node)}
                  onDragOver={(e) => node.type === 'folder' && onDragOverTarget(e, node.id)}
                  onDragLeave={() => dropTarget === node.id && setDropTarget(null)}
                  onDrop={(e) => node.type === 'folder' && onDropTarget(e, node.id)}
                >
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(node.id)}
                      onChange={(e) => toggle(node, e)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${node.name}`}
                    />
                  </td>
                  <td className="cell-name">
                    <span className="icon">{node.type === 'folder' ? '📁' : '📄'}</span>
                    <div className="name-wrap">
                      {node.type === 'folder' ? (
                        <button className="link name-btn" onClick={() => onNavigate(node.id)}>
                          {node.name}
                        </button>
                      ) : (
                        <button className="link name-btn" onClick={() => setPreview(node)}>
                          {node.name}
                        </button>
                      )}
                      {node.type === 'file' && node.alias && (
                        <span className="alias-line" title={node.aliasUrl ?? ''}>
                          🔗 /f/{node.alias}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="col-size muted">
                    {node.type === 'file' ? formatBytes(node.size) : '—'}
                  </td>
                  {!compact && (
                    <td className="col-actions">
                      {node.type === 'file' && (
                        <>
                          {isEditableImage(node) && (
                            <button className="link" onClick={() => setEditing(node)}>
                              Edit
                            </button>
                          )}
                          <button className="link" onClick={() => copyLink(node)}>
                            {copied === node.id ? 'Copied!' : 'Copy link'}
                          </button>
                          <button className="link" onClick={() => editAlias(node)}>
                            {node.alias ? 'Edit link' : 'Friendly link'}
                          </button>
                        </>
                      )}
                      <button className="link" onClick={() => rename(node)}>
                        Rename
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {preview && (
        <PreviewModal
          node={preview}
          onClose={() => setPreview(null)}
          onEdit={(n) => {
            setPreview(null);
            setEditing(n);
          }}
        />
      )}

      {editing && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <div className="modal card">
                <span className="muted">Loading editor…</span>
              </div>
            </div>
          }
        >
          <ImageEditorModal
            node={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              load();
              onAfterChange();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
