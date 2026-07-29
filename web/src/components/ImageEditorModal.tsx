import { useCallback, useEffect, useRef, useState } from 'react';
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor';
import { api, errorMessage, type NodeDto } from '../api';
import { versionedUrl } from './PreviewModal';

type Engine = 'filerobot' | 'photopea';

const PHOTOPEA_ORIGIN = 'https://www.photopea.com';

/**
 * Inline image editing.
 *
 * Two engines: Filerobot (default) runs entirely from our own bundle — offline-capable, private,
 * and enough for crop/rotate/filters/annotate. Photopea is a far more capable Photoshop-class
 * editor, but it is a third-party iframe, so it is opt-in per edit.
 *
 * Either way the result is a Blob, saved through the API so the file keeps its id, CDN token and
 * friendly alias — links already shared keep working after an edit.
 */
export function ImageEditorModal({
  node,
  onClose,
  onSaved,
}: {
  node: NodeDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [engine, setEngine] = useState<Engine>('filerobot');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  // Load the current bytes, not whatever the browser cached before a previous edit.
  const url = versionedUrl(node);

  const save = useCallback(
    async (blob: Blob, asCopy: boolean) => {
      setSaving(true);
      setStatus('Saving…');
      try {
        if (asCopy) {
          const dot = node.name.lastIndexOf('.');
          const stem = dot > 0 ? node.name.slice(0, dot) : node.name;
          const ext = blob.type === 'image/png' ? '.png' : dot > 0 ? node.name.slice(dot) : '.png';
          const file = new File([blob], `${stem} (edited)${ext}`, { type: blob.type });
          await api.upload(node.parentId ?? 'root', file, (f) =>
            setStatus(`Saving… ${Math.round(f * 100)}%`),
          );
        } else {
          await api.replaceContent(node, blob, (f) => setStatus(`Saving… ${Math.round(f * 100)}%`));
        }
        onSaved();
        onClose();
      } catch (err) {
        alert(errorMessage(err));
        setStatus('');
      } finally {
        setSaving(false);
      }
    },
    [node, onClose, onSaved],
  );

  return (
    <div className="modal-backdrop">
      <div className="modal editor-modal card" onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <div className="name-wrap">
            <strong>Editing {node.name}</strong>
            {status && <span className="muted small">{status}</span>}
          </div>
          <div className="preview-head-actions">
            <div className="engine-switch">
              <button
                className={engine === 'filerobot' ? 'active' : ''}
                onClick={() => setEngine('filerobot')}
                disabled={saving}
              >
                Basic
              </button>
              <button
                className={engine === 'photopea' ? 'active' : ''}
                onClick={() => setEngine('photopea')}
                disabled={saving}
                title="Opens the third-party Photopea editor (advanced: layers, masks, PSD)"
              >
                Advanced
              </button>
            </div>
            <button className="link" onClick={onClose} disabled={saving}>
              Close
            </button>
          </div>
        </div>

        {engine === 'filerobot' ? (
          <FilerobotEditor url={url} name={node.name} onSave={save} />
        ) : (
          <PhotopeaEditor url={url} name={node.name} onSave={save} saving={saving} />
        )}
      </div>
    </div>
  );
}

// ---- Filerobot (default, bundled) -----------------------------------------

function FilerobotEditor({
  url,
  name,
  onSave,
}: {
  url: string;
  name: string;
  onSave: (blob: Blob, asCopy: boolean) => void;
}) {
  // Filerobot hands back a data URL / canvas; convert to a Blob for upload.
  const handleSave = (imageInfo: { imageBase64?: string; mimeType?: string }, _state: unknown) => {
    if (!imageInfo.imageBase64) return;
    const [meta, b64] = imageInfo.imageBase64.split(',');
    const mime = imageInfo.mimeType || /data:([^;]+)/.exec(meta)?.[1] || 'image/png';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    onSave(new Blob([bytes], { type: mime }), false);
  };

  return (
    <div className="editor-body">
      <FilerobotImageEditor
        source={url}
        onSave={handleSave}
        onClose={() => {
          /* closing is handled by our own header button */
        }}
        defaultSavedImageName={name}
        tabsIds={[TABS.ADJUST, TABS.ANNOTATE, TABS.FILTERS, TABS.FINETUNE, TABS.RESIZE]}
        defaultTabId={TABS.ADJUST}
        defaultToolId={TOOLS.CROP}
        savingPixelRatio={1}
        previewPixelRatio={1}
      />
    </div>
  );
}

// ---- Photopea (opt-in, third-party iframe) --------------------------------

function PhotopeaEditor({
  url,
  name,
  onSave,
  saving,
}: {
  url: string;
  name: string;
  onSave: (blob: Blob, asCopy: boolean) => void;
  saving: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const pending = useRef<'save' | 'copy' | null>(null);

  // Photopea processes images in the browser; we still push the bytes over postMessage rather
  // than handing it our public /f/ URL, so our links are never given to third-party code.
  useEffect(() => {
    let cancelled = false;
    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== PHOTOPEA_ORIGIN) return;

      // The first message after load means Photopea is ready for commands.
      if (typeof e.data === 'string' && e.data === 'done' && !ready) {
        setReady(true);
        return;
      }
      // A binary reply is the exported image.
      if (e.data instanceof ArrayBuffer && pending.current) {
        const asCopy = pending.current === 'copy';
        pending.current = null;
        onSave(new Blob([e.data], { type: 'image/png' }), asCopy);
      }
    };
    window.addEventListener('message', onMessage);

    // Load the source bytes and hand them to the frame once it is up.
    (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        const buf = await res.arrayBuffer();
        const send = () => {
          if (cancelled) return;
          frameRef.current?.contentWindow?.postMessage(buf, PHOTOPEA_ORIGIN);
          setReady(true);
        };
        // Give the iframe a moment to boot before pushing the image.
        setTimeout(send, 2500);
      } catch {
        /* the user can still open the file manually */
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  function exportImage(asCopy: boolean) {
    pending.current = asCopy ? 'copy' : 'save';
    frameRef.current?.contentWindow?.postMessage(
      'app.activeDocument.saveToOE("png");',
      PHOTOPEA_ORIGIN,
    );
  }

  const config = encodeURIComponent(
    JSON.stringify({ files: [], environment: { customIO: { save: 'app.activeDocument.saveToOE("png");' } } }),
  );

  return (
    <div className="editor-body photopea">
      <div className="notice photopea-note">
        Advanced editing runs in <strong>Photopea</strong>, a third-party editor loaded from
        photopea.com (the free version shows ads). Your image is processed in your browser and is
        not uploaded to them. Editing <em>{name}</em>.
      </div>
      <iframe
        ref={frameRef}
        title="Photopea"
        src={`${PHOTOPEA_ORIGIN}#${config}`}
        allow="clipboard-read; clipboard-write"
      />
      <div className="editor-actions">
        <button disabled={!ready || saving} onClick={() => exportImage(true)}>
          Save as copy
        </button>
        <button className="primary" disabled={!ready || saving} onClick={() => exportImage(false)}>
          Save (replaces original)
        </button>
      </div>
    </div>
  );
}
