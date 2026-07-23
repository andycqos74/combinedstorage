import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { api, errorMessage, type ListResponse, type NodeDto, type Usage } from '../api';
import { formatBytes } from '../format';
import { StorageMeter } from '../components/StorageMeter';

interface UploadItem {
  id: string;
  name: string;
  pct: number;
  error?: string;
}

export function Files() {
  const [folderId, setFolderId] = useState('root');
  const [data, setData] = useState<ListResponse | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [d, u] = await Promise.all([api.list(folderId), api.storage()]);
      setData(d);
      setUsage(u);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [folderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const item: UploadItem = { id: crypto.randomUUID(), name: file.name, pct: 0 };
      setUploads((prev) => [...prev, item]);
      try {
        await api.upload(folderId, file, (f) =>
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
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }

  async function newFolder() {
    const name = window.prompt('New folder name:');
    if (!name) return;
    try {
      await api.createFolder(folderId, name);
      await load();
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
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function del(node: NodeDto) {
    const suffix = node.type === 'folder' ? ' and everything inside it' : '';
    if (!window.confirm(`Delete "${node.name}"${suffix}?`)) return;
    try {
      await api.remove(node.id);
      await load();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function copyLink(node: NodeDto) {
    if (!node.url) return;
    try {
      await navigator.clipboard.writeText(node.url);
    } catch {
      window.prompt('Copy this link:', node.url);
    }
    setCopied(node.id);
    setTimeout(() => setCopied(''), 1200);
  }

  const children = data?.children ?? [];

  return (
    <div className="page">
      {usage && <StorageMeter used={usage.used} total={usage.total} />}

      <div className="toolbar">
        <nav className="crumbs">
          {(data?.breadcrumb ?? []).map((c, i, arr) => (
            <span key={c.id}>
              <button className="crumb" onClick={() => setFolderId(c.id)}>
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
        className={`filelist${dragOver ? ' dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {children.length === 0 ? (
          <div className="empty">This folder is empty. Drop files here or use Upload.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="col-size">Size</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {children.map((node) => (
                <tr key={node.id}>
                  <td className="cell-name">
                    <span className="icon">{node.type === 'folder' ? '📁' : '📄'}</span>
                    {node.type === 'folder' ? (
                      <button className="link name-btn" onClick={() => setFolderId(node.id)}>
                        {node.name}
                      </button>
                    ) : (
                      <a href={node.url ?? '#'} target="_blank" rel="noreferrer" className="name-btn">
                        {node.name}
                      </a>
                    )}
                  </td>
                  <td className="col-size muted">
                    {node.type === 'file' ? formatBytes(node.size) : '—'}
                  </td>
                  <td className="col-actions">
                    {node.type === 'file' && (
                      <button className="link" onClick={() => copyLink(node)}>
                        {copied === node.id ? 'Copied!' : 'Copy link'}
                      </button>
                    )}
                    <button className="link" onClick={() => rename(node)}>
                      Rename
                    </button>
                    <button className="link danger" onClick={() => del(node)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
