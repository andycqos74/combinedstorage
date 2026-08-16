import { useEffect, useState } from 'react';
import type { NodeDto } from '../api';
import { formatBytes } from '../format';
import { CloseIcon } from './Icons';

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other';

/** Decide how to render a file, from its MIME type with a filename fallback. */
export function previewKind(node: NodeDto): PreviewKind {
  const mime = (node.mimeType ?? '').toLowerCase();
  const name = node.name.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    /\.(txt|md|json|csv|log|ya?ml|xml|ts|tsx|js|jsx|css|html|sh)$/.test(name)
  ) {
    return 'text';
  }
  return 'other';
}

/** Images we can hand to the editors (the canvas-based editor needs a raster format). */
export function isEditableImage(node: NodeDto): boolean {
  const mime = (node.mimeType ?? '').toLowerCase();
  return /^image\/(png|jpeg|jpg|webp|bmp|gif)$/.test(mime);
}

const TEXT_PREVIEW_LIMIT = 512 * 1024; // don't pull a huge file into the DOM

/**
 * The app's own view of a file, cache-busted by its modification time. The shareable link is
 * deliberately left clean — this only affects what the preview/editor fetch, so an edit shows
 * immediately even if the browser still holds a copy cached before the edit.
 */
export function versionedUrl(node: NodeDto): string {
  const base = node.aliasUrl ?? node.url ?? '';
  if (!base) return '';
  const v = Date.parse(node.updatedAt) || 0;
  return `${base}${base.includes('?') ? '&' : '?'}v=${v.toString(36)}`;
}

/** Types the server can render a thumbnail for (matches its convertible-image set). */
export function hasThumbnail(node: NodeDto): boolean {
  return /^image\/(jpeg|png|webp|tiff|avif)$/.test((node.mimeType ?? '').toLowerCase());
}

/**
 * A square, cropped thumbnail from the server's on-demand variant endpoint. The `v` parameter
 * only busts the browser cache — the server keys its own cache on the file's content version.
 */
export function thumbnailUrl(node: NodeDto, size = 320): string {
  const base = node.aliasUrl ?? node.url ?? '';
  if (!base) return '';
  const v = Date.parse(node.updatedAt) || 0;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}w=${size}&h=${size}&fit=cover&v=${v.toString(36)}`;
}

/** Short label for the pill in the preview head, so the type reads at a glance. */
const KIND_LABEL: Record<PreviewKind, string> = {
  image: 'Image',
  pdf: 'PDF',
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
  other: 'File',
};

export function PreviewModal({
  node,
  onClose,
  onEdit,
}: {
  node: NodeDto;
  onClose: () => void;
  onEdit?: (node: NodeDto) => void;
}) {
  const kind = previewKind(node);
  const url = versionedUrl(node);
  const downloadUrl = node.aliasUrl ?? node.url ?? '';
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind !== 'text' || !url) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        const body = await res.text();
        if (!cancelled) {
          setText(
            body.length > TEXT_PREVIEW_LIMIT
              ? `${body.slice(0, TEXT_PREVIEW_LIMIT)}\n\n… truncated …`
              : body,
          );
        }
      } catch {
        if (!cancelled) setTextError('Could not load this file.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, url]);

  return (
    <div className="modal-backdrop preview" onClick={onClose}>
      <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <div className="name-wrap">
            <strong>{node.name}</strong>
            <span className="muted small">
              {formatBytes(node.size)} · {node.mimeType ?? 'unknown type'}
            </span>
          </div>
          <div className="preview-head-actions">
            <span className="kind-pill">{KIND_LABEL[kind]}</span>
            {onEdit && isEditableImage(node) && (
              <button className="primary" onClick={() => onEdit(node)}>
                Edit image
              </button>
            )}
            <a className="button" href={downloadUrl} download={node.name}>
              Download
            </a>
            <button className="close-btn" onClick={onClose} aria-label="Close preview">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>

        <div className="preview-body">
          {kind === 'image' && <img src={url} alt={node.name} />}
          {kind === 'pdf' && <iframe src={url} title={node.name} />}
          {kind === 'video' && <video src={url} controls autoPlay={false} />}
          {kind === 'audio' && <audio src={url} controls />}
          {kind === 'text' && (
            <pre className="preview-text">{textError || text || 'Loading…'}</pre>
          )}
          {kind === 'other' && (
            <div className="preview-none muted">
              <div className="preview-none-icon">📄</div>
              No preview available for this file type. Use Download to open it locally.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
