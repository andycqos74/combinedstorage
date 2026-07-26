import { ROOT_ID, type NodeRow, getNode, childByName, listChildren } from '../models/nodes';
import { listUsableBackends } from '../models/backends';

// ---- path <-> node resolution ----------------------------------------------

/** Split a WebDAV path (already stripped of the /dav mount) into decoded, non-empty segments. */
export function splitPath(urlPath: string): string[] {
  return urlPath
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => decodeURIComponent(s));
}

/** Resolve segments to a node by walking from the tree root; undefined if any segment misses. */
export function resolveByPath(segments: string[]): NodeRow | undefined {
  let cur: NodeRow | undefined = getNode(ROOT_ID);
  for (const seg of segments) {
    if (!cur || cur.type !== 'folder') return undefined;
    cur = childByName(cur.id, seg);
  }
  return cur;
}

/** Resolve the parent folder + leaf name for a target path (for PUT/MKCOL/MOVE/COPY). */
export function resolveParentAndName(
  segments: string[],
): { parent: NodeRow; name: string } | undefined {
  if (segments.length === 0) return undefined; // the root has no parent
  const name = segments[segments.length - 1];
  const parent = resolveByPath(segments.slice(0, -1));
  if (!parent || parent.type !== 'folder') return undefined;
  return { parent, name };
}

/** Combined capacity/usage from the cached per-backend quota (no live provider calls). */
export function cachedQuota(): { total: number; used: number } {
  let total = 0;
  let used = 0;
  for (const b of listUsableBackends()) {
    total += b.quota_total ?? 0;
    used += b.quota_used ?? 0;
  }
  return { total, used };
}

// ---- PROPFIND XML ----------------------------------------------------------

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

function rfc1123(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

/** Build the href for a node path, encoding each segment and marking collections with a slash. */
export function hrefFor(mount: string, segments: string[], isDir: boolean): string {
  const encoded = segments.map((s) => encodeURIComponent(s)).join('/');
  let href = encoded ? `${mount}/${encoded}` : `${mount}/`;
  if (isDir && !href.endsWith('/')) href += '/';
  return href;
}

function responseXml(href: string, node: NodeRow, quota?: { used: number; total: number }): string {
  const isDir = node.type === 'folder';
  const props: string[] = [
    `<D:displayname>${xmlEscape(node.id === ROOT_ID ? '' : node.name)}</D:displayname>`,
    `<D:creationdate>${new Date(node.created_at).toISOString()}</D:creationdate>`,
    `<D:getlastmodified>${rfc1123(node.updated_at)}</D:getlastmodified>`,
  ];
  if (isDir) {
    props.push('<D:resourcetype><D:collection/></D:resourcetype>');
    if (quota) {
      const available = Math.max(0, quota.total - quota.used);
      props.push(`<D:quota-used-bytes>${quota.used}</D:quota-used-bytes>`);
      props.push(`<D:quota-available-bytes>${available}</D:quota-available-bytes>`);
    }
  } else {
    props.push('<D:resourcetype/>');
    props.push(`<D:getcontentlength>${node.size ?? 0}</D:getcontentlength>`);
    props.push(
      `<D:getcontenttype>${xmlEscape(node.mime_type ?? 'application/octet-stream')}</D:getcontenttype>`,
    );
    if (node.public_token) props.push(`<D:getetag>"${node.public_token}"</D:getetag>`);
  }
  return (
    `<D:response><D:href>${xmlEscape(href)}</D:href>` +
    `<D:propstat><D:prop>${props.join('')}</D:prop>` +
    `<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
  );
}

/** Build a full <multistatus> PROPFIND body for a node (+ its children when depth >= 1). */
export function propfindXml(opts: {
  mount: string;
  segments: string[];
  node: NodeRow;
  depth: number;
  quota?: { used: number; total: number };
}): string {
  const { mount, segments, node, depth, quota } = opts;
  const parts = [responseXml(hrefFor(mount, segments, node.type === 'folder'), node, quota)];
  if (depth >= 1 && node.type === 'folder') {
    for (const child of listChildren(node.id)) {
      parts.push(responseXml(hrefFor(mount, [...segments, child.name], child.type === 'folder'), child));
    }
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">${parts.join('')}</D:multistatus>`;
}
