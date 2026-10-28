import { type NodeRow, getOwnedNode, childByName, listChildren } from '../models/nodes';
import { listUsableBackends } from '../models/backends';
import { getUser } from '../models/users';
import { fileEtag } from './files';

// ---- path <-> node resolution ----------------------------------------------

/** Split a WebDAV path (already stripped of the /dav mount) into decoded, non-empty segments. */
export function splitPath(urlPath: string): string[] {
  return urlPath
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => decodeURIComponent(s));
}

/** Resolve segments to a node by walking from the user's root; undefined if any segment misses. */
export function resolveByPath(userId: string, segments: string[]): NodeRow | undefined {
  const user = getUser(userId);
  let cur: NodeRow | undefined = user ? getOwnedNode(userId, user.root_id) : undefined;
  for (const seg of segments) {
    if (!cur || cur.type !== 'folder') return undefined;
    cur = childByName(cur.id, seg);
  }
  return cur;
}

/** Resolve the parent folder + leaf name for a target path (for PUT/MKCOL/MOVE/COPY). */
export function resolveParentAndName(
  userId: string,
  segments: string[],
): { parent: NodeRow; name: string } | undefined {
  if (segments.length === 0) return undefined; // the root has no parent
  const name = segments[segments.length - 1];
  const parent = resolveByPath(userId, segments.slice(0, -1));
  if (!parent || parent.type !== 'folder') return undefined;
  return { parent, name };
}

/** A user's combined capacity/usage from the cached per-backend quota (no live provider calls). */
export function cachedQuota(userId: string): { total: number; used: number } {
  let total = 0;
  let used = 0;
  for (const b of listUsableBackends(userId)) {
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
    `<D:displayname>${xmlEscape(node.parent_id === null ? '' : node.name)}</D:displayname>`,
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
    // Version-aware ETag: an in-place edit keeps the token, so a token-only value would tell
    // clients (e.g. rclone's cache) that an edited file was unchanged.
    const etag = fileEtag(node);
    if (etag) props.push(`<D:getetag>${xmlEscape(etag)}</D:getetag>`);
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
