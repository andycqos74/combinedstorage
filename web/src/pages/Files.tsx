import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, type BulkResult, type Usage } from '../api';
import { StorageMeter } from '../components/StorageMeter';
import { FilePane, type DragPayload } from '../components/FilePane';
import { FolderPicker } from '../components/FolderPicker';

/** Summarize a bulk result, surfacing partial failures rather than silently swallowing them. */
function reportBulk(result: BulkResult, verb: string): void {
  if (result.failed.length === 0) return;
  const lines = result.failed.map((f) => `• ${f.name ?? f.id}: ${f.error}`).join('\n');
  alert(
    `${result.succeeded.length} item(s) ${verb}, ${result.failed.length} failed:\n\n${lines}`,
  );
}

export function Files() {
  const [leftFolder, setLeftFolder] = useState('root');
  const [rightFolder, setRightFolder] = useState('root');
  const [twoPane, setTwoPane] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<'move' | 'copy' | null>(null);

  const reloadLeft = useRef<() => void>(() => {});
  const reloadRight = useRef<() => void>(() => {});

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

  /** Reload both panes and the storage meter after anything that changes data. */
  const refreshAll = useCallback(() => {
    reloadLeft.current();
    reloadRight.current();
    refreshUsage();
  }, [refreshUsage]);

  const clearSelection = () => setSelected(new Set());

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
      reportBulk(result, copy ? 'copied' : 'moved');
      clearSelection();
      refreshAll();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ---- bulk actions -------------------------------------------------------

  const ids = Array.from(selected);

  async function runBulk(
    fn: () => Promise<BulkResult>,
    verb: string,
    confirmMessage?: string,
  ) {
    if (ids.length === 0) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    try {
      reportBulk(await fn(), verb);
      clearSelection();
      refreshAll();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      {usage && <StorageMeter used={usage.used} total={usage.total} />}

      <div className="pane-controls">
        <button onClick={() => setTwoPane((v) => !v)}>
          {twoPane ? 'Single pane' : 'Two panes'}
        </button>
        <span className="muted small">
          Drag items onto a folder{twoPane ? ', a breadcrumb, or the other pane' : ' or a breadcrumb'} to
          move them — hold Ctrl to copy.
        </span>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar">
          <span className="bulk-count">{selected.size} selected</span>
          <button
            disabled={busy}
            onClick={() =>
              runBulk(
                () => api.bulkDelete(ids),
                'deleted',
                `Delete ${selected.size} item(s)? Folders are deleted with everything inside them.`,
              )
            }
            className="danger-btn"
          >
            Delete
          </button>
          <button disabled={busy} onClick={() => runBulk(() => api.bulkAlias(ids), 'linked')}>
            Friendly links
          </button>
          <button disabled={busy} onClick={() => setPicker('move')}>
            Move to…
          </button>
          <button disabled={busy} onClick={() => setPicker('copy')}>
            Copy to…
          </button>
          {twoPane && (
            <>
              <button
                disabled={busy}
                onClick={() => runBulk(() => api.bulkMove(ids, rightFolder), 'moved')}
              >
                Move →
              </button>
              <button
                disabled={busy}
                onClick={() => runBulk(() => api.bulkCopy(ids, rightFolder), 'copied')}
              >
                Copy →
              </button>
              <button
                disabled={busy}
                onClick={() => runBulk(() => api.bulkMove(ids, leftFolder), 'moved')}
              >
                ← Move
              </button>
              <button
                disabled={busy}
                onClick={() => runBulk(() => api.bulkCopy(ids, leftFolder), 'copied')}
              >
                ← Copy
              </button>
            </>
          )}
          <button className="link" onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}

      <div className={`panes${twoPane ? ' two' : ''}`}>
        <FilePane
          folderId={leftFolder}
          onNavigate={setLeftFolder}
          selected={selected}
          onSelectedChange={setSelected}
          onDropNodes={handleDrop}
          onAfterChange={refreshAll}
          registerReload={(fn) => (reloadLeft.current = fn)}
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
            registerReload={(fn) => (reloadRight.current = fn)}
            title="Right"
            compact
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
    </div>
  );
}
