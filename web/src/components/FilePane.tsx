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
import { backendLabel, backendTone } from '../backends';
import {
  PreviewModal,
  isEditableImage,
  hasThumbnail,
  thumbnailUrl,
  copyToClipboard,
} from './PreviewModal';
import { FolderIcon, FileIcon, ListIcon, GridIcon } from './Icons';
import { Badge, Button, Checkbox, Dialog, IconButton, MonoLabel, PromptDialog, type Tone } from './ui';

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

/** Mirror of the server's alias slug rules, so the dialog's hint shows the link it will get. */
function aliasSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** A friendly-link suggestion from a file name: its stem, slugged ("Annual Report.pdf" -> "annual-report"). */
function suggestedAlias(name: string): string {
  return aliasSlug(name.replace(/\.[^.]+$/, ''));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type PaneDialog =
  | { kind: 'folder' }
  | { kind: 'rename'; node: NodeDto }
  | { kind: 'alias'; node: NodeDto };

export function FilePane({
  folderId,
  onNavigate,
  selected,
  onSelectedChange,
  onDropNodes,
  onAfterChange,
  onToast,
  registerReload,
  registerUpload,
  registerNewFolder,
  onSummary,
  title,
  compact = false,
}: {
  folderId: string;
  onNavigate: (id: string) => void;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Called when nodes are dropped onto a folder in this pane (or its background). */
  onDropNodes: (payload: DragPayload, destFolderId: string, copy: boolean) => void;
  /** Called after this pane changes data (upload, new folder, rename…) so siblings refresh. */
  onAfterChange: () => void;
  onToast?: (message: string, tone?: Tone) => void;
  registerReload?: (reload: () => void) => void;
  /** Let the page's header buttons drive this pane's upload / new-folder actions. */
  registerUpload?: (fn: () => void) => void;
  registerNewFolder?: (fn: () => void) => void;
  onSummary?: (count: number, folderName: string) => void;
  title?: string;
  /** Two-pane layout: narrower columns and no per-row actions. */
  compact?: boolean;
}) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // node id, or '' for the pane
  const [copied, setCopied] = useState('');
  const [preview, setPreview] = useState<NodeDto | null>(null);
  const [editing, setEditing] = useState<NodeDto | null>(null);
  const [dialog, setDialog] = useState<PaneDialog | null>(null);
  // Remembered across visits and shared by both panes; a media folder is easier as a grid.
  const [view, setView] = useState<'list' | 'grid'>(() =>
    localStorage.getItem('cs.view') === 'grid' ? 'grid' : 'list',
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const lastClicked = useRef<string | null>(null);

  function changeView(next: 'list' | 'grid') {
    setView(next);
    localStorage.setItem('cs.view', next);
    window.dispatchEvent(new CustomEvent('cs:view', { detail: next }));
  }

  // View mode is global: follow a change made in the other pane.
  useEffect(() => {
    const onView = (e: Event) => setView((e as CustomEvent<'list' | 'grid'>).detail);
    window.addEventListener('cs:view', onView);
    return () => window.removeEventListener('cs:view', onView);
  }, []);

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
  const crumbs = data?.breadcrumb ?? [];
  // The folder's real id (the API also accepts "root"), so drops onto the pane body work.
  const currentId = data?.folder.id ?? folderId;

  useEffect(() => {
    if (data) onSummary?.(data.children.length, crumbs[crumbs.length - 1]?.name ?? 'Home');
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selection ----------------------------------------------------------

  function toggle(node: NodeDto, e: React.MouseEvent | React.ChangeEvent) {
    const next = new Set(selected);
    // A checkbox's ChangeEvent doesn't carry modifier keys, but the native event it wraps does.
    const shift =
      ('shiftKey' in e && (e as React.MouseEvent).shiftKey) ||
      (e.nativeEvent as MouseEvent | undefined)?.shiftKey === true;

    if (shift && lastClicked.current) {
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
    const ids = selected.has(node.id) ? Array.from(selected) : [node.id];
    const payload: DragPayload = { ids, sourceFolderId: currentId };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copyMove';
  }

  const isInternalDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_MIME);

  function onDragOverTarget(e: DragEvent, targetId: string) {
    if (!isInternalDrag(e) && e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
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
      onDropNodes(JSON.parse(raw) as DragPayload, destFolderId, e.ctrlKey || e.metaKey);
      return;
    }
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files, destFolderId);
  }

  // ---- actions ------------------------------------------------------------

  const uploadFiles = useCallback(
    async (fileList: FileList | File[], destFolderId = folderId) => {
      let done = 0;
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
          done++;
        } catch (err) {
          setUploads((prev) =>
            prev.map((u) => (u.id === item.id ? { ...u, error: errorMessage(err) } : u)),
          );
        }
      }
      if (done > 0) onToast?.(`${plural(done, 'item')} uploaded`);
      await load();
      onAfterChange();
    },
    [folderId, load, onAfterChange, onToast],
  );

  const openNewFolder = useCallback(() => setDialog({ kind: 'folder' }), []);

  // The page header drives this pane's Upload / New folder buttons.
  useEffect(() => {
    registerUpload?.(() => inputRef.current?.click());
    registerNewFolder?.(openNewFolder);
  }, [registerUpload, registerNewFolder, openNewFolder]);

  /** Run a change from a dialog; errors are thrown back so the dialog shows them. */
  async function apply(change: () => Promise<unknown>, toast?: string) {
    await change();
    setDialog(null);
    await load();
    onAfterChange();
    if (toast) onToast?.(toast);
  }

  async function copyLink(node: NodeDto) {
    const link = node.aliasUrl ?? node.url;
    if (!link) return;
    await copyToClipboard(link);
    setCopied(node.id);
    setTimeout(() => setCopied(''), 1200);
  }

  function open(node: NodeDto) {
    if (node.type === 'folder') onNavigate(node.id);
    else setPreview(node);
  }

  const rowDnD = (node: NodeDto) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => onDragStart(e, node),
    onDragOver: (e: DragEvent) => node.type === 'folder' && onDragOverTarget(e, node.id),
    onDragLeave: () => dropTarget === node.id && setDropTarget(null),
    onDrop: (e: DragEvent) => node.type === 'folder' && onDropTarget(e, node.id),
  });

  return (
    <div className={`pane${compact ? ' compact' : ''}`}>
      <div className="pane-head">
        {title && <MonoLabel className="pane-title">{title}</MonoLabel>}
        <nav className="crumbs" aria-label="Folder path">
          {crumbs.map((c, i, arr) => (
            <span key={c.id} className="crumb-step">
              <button
                className={`crumb${i === arr.length - 1 ? ' current' : ''}${
                  dropTarget === `crumb:${c.id}` ? ' droptarget' : ''
                }`}
                onClick={() => onNavigate(c.id)}
                onDragOver={(e) => onDragOverTarget(e, `crumb:${c.id}`)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => onDropTarget(e, c.id)}
              >
                {c.name}
              </button>
              {i < arr.length - 1 && <span className="crumb-sep">/</span>}
            </span>
          ))}
        </nav>
        <div className="view-switch" role="group" aria-label="View mode">
          <IconButton
            label="List view"
            size="sm"
            variant={view === 'list' ? 'secondary' : 'ghost'}
            onClick={() => changeView('list')}
          >
            <ListIcon />
          </IconButton>
          <IconButton
            label="Grid view with thumbnails"
            size="sm"
            variant={view === 'grid' ? 'secondary' : 'ghost'}
            onClick={() => changeView('grid')}
          >
            <GridIcon />
          </IconButton>
        </div>
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

      {error && <div className="banner-error">{error}</div>}

      {uploads.length > 0 && (
        <div className="uploads">
          {uploads.map((u) => (
            <div key={u.id} className="upload-row">
              <span className="ellipsis">{u.name}</span>
              {u.error ? (
                <span className="upload-error">{u.error}</span>
              ) : (
                <>
                  <span className="mono-meta">{u.pct}%</span>
                  <span className="bar">
                    <span className="bar-fill" style={{ width: `${u.pct}%` }} />
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        className={`pane-body${dropTarget === '' ? ' dragover' : ''}`}
        onDragOver={(e) => onDragOverTarget(e, '')}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => onDropTarget(e, currentId)}
      >
        {children.length === 0 ? (
          <div className="empty">
            <FolderIcon size={28} />
            <span>This folder is empty. Drop files here or use Upload.</span>
          </div>
        ) : view === 'grid' ? (
          <div className="tiles">
            {children.map((node) => (
              <div
                key={node.id}
                className={
                  'tile' +
                  (selected.has(node.id) ? ' selected' : '') +
                  (dropTarget === node.id ? ' droptarget' : '')
                }
                {...rowDnD(node)}
              >
                <span className="tile-check">
                  <Checkbox
                    label={`Select ${node.name}`}
                    checked={selected.has(node.id)}
                    onChange={(e) => toggle(node, e)}
                  />
                </span>
                <button className="tile-open" onClick={() => open(node)} title={node.name}>
                  <span className={`tile-thumb${node.type === 'folder' ? ' folder' : ''}`}>
                    {node.type === 'folder' ? (
                      <FolderIcon size={30} />
                    ) : hasThumbnail(node) ? (
                      <img src={thumbnailUrl(node)} alt="" loading="lazy" />
                    ) : (
                      <FileIcon size={26} />
                    )}
                  </span>
                  <span className={`tile-name${node.type === 'folder' ? ' folder' : ''}`}>
                    {node.name}
                  </span>
                </button>
                <MonoLabel>{node.type === 'file' ? formatBytes(node.size) : 'Folder'}</MonoLabel>
              </div>
            ))}
          </div>
        ) : (
          <div className="list" role="table" aria-label="Files">
            <div className="list-row list-head" role="row">
              <Checkbox label="Select all" checked={allSelected} onChange={toggleAll} />
              <MonoLabel>Name</MonoLabel>
              <MonoLabel className="align-right">Size</MonoLabel>
              <MonoLabel className="col-backend">Stored on</MonoLabel>
              {!compact && <MonoLabel className="align-right col-actions">Actions</MonoLabel>}
            </div>
            {children.map((node) => (
              <div
                key={node.id}
                role="row"
                className={
                  'list-row list-item' +
                  (selected.has(node.id) ? ' selected' : '') +
                  (dropTarget === node.id ? ' droptarget' : '')
                }
                {...rowDnD(node)}
              >
                <Checkbox
                  label={`Select ${node.name}`}
                  checked={selected.has(node.id)}
                  onChange={(e) => toggle(node, e)}
                />
                <div className="cell-name">
                  <span className={`chip${node.type === 'folder' ? ' folder' : ''}`}>
                    {node.type === 'folder' ? <FolderIcon size={16} /> : <FileIcon size={15} />}
                  </span>
                  <div className="name-stack">
                    <button
                      className={`name-btn${node.type === 'folder' ? ' folder' : ''}`}
                      onClick={() => open(node)}
                      title={node.name}
                    >
                      {node.name}
                    </button>
                    {node.type === 'file' && node.alias && (
                      <span className="alias-line" title={node.aliasUrl ?? ''}>
                        /f/{node.alias}
                      </span>
                    )}
                  </div>
                </div>
                <span className="cell-size">{node.type === 'file' ? formatBytes(node.size) : '—'}</span>
                <div className="col-backend">
                  {node.type === 'file' && node.backendType ? (
                    <Badge tone={backendTone(node.backendType)}>{backendLabel(node.backendType)}</Badge>
                  ) : (
                    <Badge tone="neutral">spread</Badge>
                  )}
                </div>
                {!compact && (
                  <div className="cell-actions">
                    {node.type === 'file' && (
                      <>
                        {isEditableImage(node) && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(node)}>
                            Edit
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => copyLink(node)}>
                          {copied === node.id ? 'Copied' : 'Copy link'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'alias', node })}
                        >
                          {node.alias ? 'Edit link' : 'Friendly link'}
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'rename', node })}>
                      Rename
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pane-hint">
        Drag items onto a folder or a breadcrumb to move them. Hold Ctrl to copy.
      </div>

      {dialog?.kind === 'folder' && (
        <PromptDialog
          title="New folder"
          label="Folder name"
          action="Create"
          onClose={() => setDialog(null)}
          onSubmit={(name) => apply(() => api.createFolder(folderId, name), `Created “${name}”`)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename"
          label="Name"
          action="Save"
          initial={dialog.node.name}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            name === dialog.node.name ? setDialog(null) : apply(() => api.rename(dialog.node.id, name))
          }
        />
      )}
      {dialog?.kind === 'alias' && (
        <PromptDialog
          title="Friendly link"
          label={`Path for ${dialog.node.name}`}
          action="Save"
          initial={dialog.node.alias ?? suggestedAlias(dialog.node.name)}
          hint={(value) => `Opens at /f/${aliasSlug(value) || '…'}`}
          onClose={() => setDialog(null)}
          onSubmit={(alias) => apply(() => api.setAlias(dialog.node.id, alias))}
          extraAction={
            dialog.node.alias
              ? { label: 'Remove link', run: () => apply(() => api.clearAlias(dialog.node.id)) }
              : undefined
          }
        />
      )}

      {preview && (
        <PreviewModal
          node={preview}
          onClose={() => setPreview(null)}
          onToast={(m) => onToast?.(m)}
          onEdit={(n) => {
            setPreview(null);
            setEditing(n);
          }}
        />
      )}

      {editing && (
        <Suspense
          fallback={
            <Dialog title="Loading editor…" onClose={() => setEditing(null)}>
              <span className="body-s">Fetching the image editor.</span>
            </Dialog>
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
