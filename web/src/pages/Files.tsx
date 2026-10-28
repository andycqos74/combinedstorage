import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, type BulkResult, type Usage } from '../api';
import { StorageMeter } from '../components/StorageMeter';
import { FilePane, type DragPayload } from '../components/FilePane';
import { FolderPicker } from '../components/FolderPicker';
import { Button, ConfirmDialog, MonoLabel, Toast, type Tone, type ToastMessage } from '../components/ui';
import { UploadIcon, FolderPlusIcon } from '../components/Icons';

const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/** Toast for a bulk result, surfacing partial failures rather than silently swallowing them. */
function bulkToast(result: BulkResult, verb: string): ToastMessage {
  const ok = `${items(result.succeeded.length)} ${verb}`;
  if (result.failed.length === 0) return { text: ok };
  const lines = result.failed.map((f) => `${f.name ?? f.id}: ${f.error}`).join('\n');
  return { text: `${ok}, ${result.failed.length} failed\n${lines}`, tone: 'danger' };
}

export function Files({
  folderId,
  onFolderChange,
  onDataChange,
}: {
  folderId: string;
  onFolderChange: (id: string) => void;
  onDataChange: () => void;
}) {
  const [rightFolder, setRightFolder] = useState('root');
  const [twoPane, setTwoPane] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<'move' | 'copy' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [leftCount, setLeftCount] = useState(0);
  const [leftName, setLeftName] = useState('Home');

  const reloadLeft = useRef<() => void>(() => {});
  const reloadRight = useRef<() => void>(() => {});
  const uploadLeft = useRef<() => void>(() => {});
  const newFolderLeft = useRef<() => void>(() => {});

  const notify = useCallback((text: string, tone?: Tone) => setToast({ text, tone }), []);
  const dismissToast = useCallback(() => setToast(null), []);

  const refreshUsage = useCallback(async () => {
    try {
      setUsage(await api.storage());
    } catch {
      /* meter is non-critical */
    }
  }, []);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  /** Reload both panes, the storage meter and the shell after anything that changes data. */
  const refreshAll = useCallback(() => {
    reloadLeft.current();
    reloadRight.current();
    refreshUsage();
    onDataChange();
  }, [refreshUsage, onDataChange]);

  const clearSelection = () => setSelected(new Set());
  const ids = Array.from(selected);

  async function runBulk(fn: () => Promise<BulkResult>, verb: string) {
    setBusy(true);
    try {
      setToast(bulkToast(await fn(), verb));
      clearSelection();
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setBusy(false);
    }
  }

  // ---- drag and drop between folders/panes --------------------------------

  async function handleDrop(payload: DragPayload, destFolderId: string, copy: boolean) {
    // Dropping onto the folder the items already live in is a no-op.
    if (payload.sourceFolderId === destFolderId && !copy) return;
    if (payload.ids.includes(destFolderId)) {
      notify('A folder cannot be moved into itself.', 'danger');
      return;
    }
    await runBulk(
      () =>
        copy ? api.bulkCopy(payload.ids, destFolderId) : api.bulkMove(payload.ids, destFolderId),
      copy ? 'copied' : 'moved',
    );
  }

  const backendCount = usage?.backends.length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-intro">
          <h1 className="h1">Files</h1>
          <p className="body">
            {items(leftCount)} in {leftName}
            {backendCount > 0 &&
              ` · spread across ${backendCount} backend${backendCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="page-actions">
          <Button variant={twoPane ? 'primary' : 'secondary'} onClick={() => setTwoPane((v) => !v)}>
            {twoPane ? 'Single pane' : 'Two panes'}
          </Button>
          <Button variant="secondary" onClick={() => newFolderLeft.current()}>
            <FolderPlusIcon /> New folder
          </Button>
          <Button variant="primary" onClick={() => uploadLeft.current()}>
            <UploadIcon /> Upload
          </Button>
        </div>
      </div>

      {usage && <StorageMeter used={usage.used} total={usage.total} backends={usage.backends} />}

      {selected.size > 0 && (
        <div className="selection-bar">
          <MonoLabel>{selected.size} selected</MonoLabel>
          <span className="selection-divider" />
          <Button size="sm" disabled={busy} onClick={() => setPicker('move')}>
            Move to…
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setPicker('copy')}>
            Copy to…
          </Button>
          <Button size="sm" disabled={busy} onClick={() => runBulk(() => api.bulkAlias(ids), 'linked')}>
            Friendly links
          </Button>
          {twoPane && (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => runBulk(() => api.bulkMove(ids, rightFolder), 'moved')}
              >
                Move →
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => runBulk(() => api.bulkCopy(ids, rightFolder), 'copied')}
              >
                Copy →
              </Button>
            </>
          )}
          <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          <span className="spacer" />
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      <div className={`panes${twoPane ? ' two' : ''}`}>
        <FilePane
          folderId={folderId}
          onNavigate={onFolderChange}
          selected={selected}
          onSelectedChange={setSelected}
          onDropNodes={handleDrop}
          onAfterChange={refreshAll}
          onToast={notify}
          registerReload={(fn) => (reloadLeft.current = fn)}
          registerUpload={(fn) => (uploadLeft.current = fn)}
          registerNewFolder={(fn) => (newFolderLeft.current = fn)}
          onSummary={(count, name) => {
            setLeftCount(count);
            setLeftName(name);
          }}
          title={twoPane ? 'Left' : undefined}
          compact={twoPane}
        />
        {twoPane && (
          <FilePane
            folderId={rightFolder}
            onNavigate={setRightFolder}
            selected={selected}
            onSelectedChange={setSelected}
            onDropNodes={handleDrop}
            onAfterChange={refreshAll}
            onToast={notify}
            registerReload={(fn) => (reloadRight.current = fn)}
            title="Right"
            compact
          />
        )}
      </div>

      {picker && (
        <FolderPicker
          title={`${picker === 'move' ? 'Move' : 'Copy'} ${items(selected.size)} to…`}
          actionLabel={picker === 'move' ? 'Move here' : 'Copy here'}
          excludeIds={selected}
          onCancel={() => setPicker(null)}
          onChoose={(destId) => {
            setPicker(null);
            runBulk(
              () => (picker === 'move' ? api.bulkMove(ids, destId) : api.bulkCopy(ids, destId)),
              picker === 'move' ? 'moved' : 'copied',
            );
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${items(selected.size)}?`}
          body="Folders are deleted with everything inside them."
          action="Delete"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            await runBulk(() => api.bulkDelete(ids), 'deleted');
          }}
        />
      )}

      {toast && <Toast message={toast} onDone={dismissToast} />}
    </div>
  );
}
