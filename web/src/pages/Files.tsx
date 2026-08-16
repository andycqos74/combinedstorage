import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, type BulkResult, type Usage } from '../api';
import { StorageMeter } from '../components/StorageMeter';
import { FilePane, type DragPayload } from '../components/FilePane';
import { FolderPicker } from '../components/FolderPicker';
import { Toast } from '../components/Toast';
import { UploadIcon, FolderPlusIcon } from '../components/Icons';

/** Summarize a bulk result, surfacing partial failures rather than silently swallowing them. */
function reportBulk(result: BulkResult, verb: string): string | null {
  if (result.failed.length === 0) {
    return `${result.succeeded.length} item${result.succeeded.length === 1 ? '' : 's'} ${verb}`;
  }
  const lines = result.failed.map((f) => `• ${f.name ?? f.id}: ${f.error}`).join('\n');
  alert(`${result.succeeded.length} item(s) ${verb}, ${result.failed.length} failed:\n\n${lines}`);
  return null;
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
  const [toast, setToast] = useState('');
  const [leftCount, setLeftCount] = useState(0);
  const [leftName, setLeftName] = useState('Home');

  const reloadLeft = useRef<() => void>(() => {});
  const reloadRight = useRef<() => void>(() => {});
  const uploadLeft = useRef<() => void>(() => {});
  const newFolderLeft = useRef<() => void>(() => {});

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

  // ---- drag and drop between folders/panes --------------------------------

  async function handleDrop(payload: DragPayload, destFolderId: string, copy: boolean) {
    // Dropping onto the folder the items already live in is a no-op.
    if (payload.sourceFolderId === destFolderId && !copy) return;
    if (payload.ids.includes(destFolderId)) {
      alert('A folder cannot be moved into itself.');
      return;
    }
    setBusy(true);
    try {
      const result = copy
        ? await api.bulkCopy(payload.ids, destFolderId)
        : await api.bulkMove(payload.ids, destFolderId);
      const ok = reportBulk(result, copy ? 'copied' : 'moved');
      if (ok) setToast(ok);
      clearSelection();
      refreshAll();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ---- bulk actions -------------------------------------------------------

  async function runBulk(fn: () => Promise<BulkResult>, verb: string, confirmMessage?: string) {
    if (ids.length === 0) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    try {
      const ok = reportBulk(await fn(), verb);
      if (ok) setToast(ok);
      clearSelection();
      refreshAll();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const backendCount = usage?.backends.length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Files</h1>
          <p className="page-sub">
            {leftCount} item{leftCount === 1 ? '' : 's'} in {leftName}
            {backendCount > 0 && ` · spread across ${backendCount} backend${backendCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="page-actions">
          <button
            className={twoPane ? 'toggle-on' : ''}
            onClick={() => setTwoPane((v) => !v)}
          >
            {twoPane ? 'Single pane' : 'Two panes'}
          </button>
          <button className="with-icon" onClick={() => newFolderLeft.current()}>
            <FolderPlusIcon /> New folder
          </button>
          <button className="primary" onClick={() => uploadLeft.current()}>
            <UploadIcon /> Upload
          </button>
        </div>
      </div>

      {usage && (
        <StorageMeter used={usage.used} total={usage.total} backends={usage.backends} />
      )}

      {selected.size > 0 && (
        <div className="bulkbar">
          <span className="bulk-count">{selected.size} selected</span>
          <span className="bulk-divider" />
          <button disabled={busy} onClick={() => setPicker('move')}>
            Move to…
          </button>
          <button disabled={busy} onClick={() => setPicker('copy')}>
            Copy to…
          </button>
          <button disabled={busy} onClick={() => runBulk(() => api.bulkAlias(ids), 'linked')}>
            Friendly links
          </button>
          {twoPane && (
            <>
              <button disabled={busy} onClick={() => runBulk(() => api.bulkMove(ids, rightFolder), 'moved')}>
                Move →
              </button>
              <button disabled={busy} onClick={() => runBulk(() => api.bulkCopy(ids, rightFolder), 'copied')}>
                Copy →
              </button>
            </>
          )}
          <button
            className="danger-btn"
            disabled={busy}
            onClick={() =>
              runBulk(
                () => api.bulkDelete(ids),
                'deleted',
                `Delete ${selected.size} item(s)? Folders are deleted with everything inside them.`,
              )
            }
          >
            Delete
          </button>
          <button className="link" onClick={clearSelection}>
            Clear
          </button>
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
          onToast={setToast}
          registerReload={(fn) => (reloadLeft.current = fn)}
          registerUpload={(fn) => (uploadLeft.current = fn)}
          registerNewFolder={(fn) => (newFolderLeft.current = fn)}
          onSummary={(count, name) => {
            setLeftCount(count);
            setLeftName(name);
          }}
          title={twoPane ? 'Left' : undefined}
        />
        {twoPane && (
          <FilePane
            folderId={rightFolder}
            onNavigate={setRightFolder}
            selected={selected}
            onSelectedChange={setSelected}
            onDropNodes={handleDrop}
            onAfterChange={refreshAll}
            onToast={setToast}
            registerReload={(fn) => (reloadRight.current = fn)}
            title="Right"
          />
        )}
      </div>

      {picker && (
        <FolderPicker
          title={`${picker === 'move' ? 'Move' : 'Copy'} ${selected.size} item(s) to…`}
          actionLabel={picker === 'move' ? 'Move here' : 'Copy here'}
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

      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </div>
  );
}
