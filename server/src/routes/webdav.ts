import { Router, type Request, type Response } from 'express';
import { davBasicAuth } from '../middleware/davAuth';
import { asyncHandler } from '../util/asyncHandler';
import { parseRange } from '../util/range';
import * as files from '../services/files';
import * as dav from '../services/webdav';
import { ROOT_ID } from '../models/nodes';
import { lockStore } from '../webdav/locks';

export const webdavRouter = Router();

const ALLOW = 'OPTIONS, GET, HEAD, PROPFIND, PUT, DELETE, MKCOL, MOVE, COPY, PROPPATCH, LOCK, UNLOCK';

// ---- helpers ---------------------------------------------------------------

/** Parse a Destination header (absolute URL or path) into logical path segments under the mount. */
function parseDestination(req: Request): string[] | null {
  const dest = req.headers.destination;
  if (typeof dest !== 'string') return null;
  let pathname: string;
  try {
    pathname = new URL(dest, `http://${req.headers.host ?? 'localhost'}`).pathname;
  } catch {
    pathname = dest;
  }
  const mount = req.baseUrl;
  if (!pathname.startsWith(mount)) return null;
  return dav.splitPath(pathname.slice(mount.length));
}

function wantsOverwrite(req: Request): boolean {
  return (req.headers.overwrite ?? 'T').toString().toUpperCase() !== 'F';
}

// ---- method handlers -------------------------------------------------------

function handleOptions(_req: Request, res: Response): void {
  res.setHeader('DAV', '1, 2');
  res.setHeader('Allow', ALLOW);
  res.setHeader('MS-Author-Via', 'DAV');
  res.status(200).end();
}

function handlePropfind(req: Request, res: Response): void {
  const segments = dav.splitPath(req.path);
  const node = dav.resolveByPath(segments);
  if (!node) {
    res.status(404).end();
    return;
  }
  const depth = (req.headers.depth ?? '1').toString() === '0' ? 0 : 1;
  const quota = node.type === 'folder' ? dav.cachedQuota() : undefined;
  const xml = dav.propfindXml({ mount: req.baseUrl, segments, node, depth, quota });
  res.status(207).setHeader('Content-Type', 'application/xml; charset=utf-8').send(xml);
}

async function handleGet(req: Request, res: Response): Promise<void> {
  const node = dav.resolveByPath(dav.splitPath(req.path));
  if (!node) {
    res.status(404).end();
    return;
  }
  if (node.type === 'folder') {
    res.status(405).setHeader('Allow', 'OPTIONS, PROPFIND').end();
    return;
  }

  const size = node.size ?? 0;
  res.setHeader('Content-Type', node.mime_type || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', new Date(node.updated_at).toUTCString());
  if (node.public_token) res.setHeader('ETag', `"${node.public_token}"`);

  const range = parseRange(typeof req.headers.range === 'string' ? req.headers.range : undefined, size);
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else {
    res.setHeader('Content-Length', String(size));
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const { stream } = await files.openFile(node, range ?? undefined);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

async function handlePut(req: Request, res: Response): Promise<void> {
  const segments = dav.splitPath(req.path);
  const target = dav.resolveParentAndName(segments);
  if (!target) {
    res.status(409).end(); // missing parent collection (or root)
    return;
  }
  const created = !dav.resolveByPath(segments);
  const size = Number(req.headers['content-length'] ?? 0);
  const contentType =
    typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined;
  await files.writeFileAtPath({
    parentId: target.parent.id,
    name: target.name,
    stream: req,
    size: Number.isFinite(size) ? size : 0,
    mimeType: contentType,
  });
  res.status(created ? 201 : 204).end();
}

function handleMkcol(req: Request, res: Response): void {
  const segments = dav.splitPath(req.path);
  const target = dav.resolveParentAndName(segments);
  if (!target) {
    res.status(409).end();
    return;
  }
  if (dav.resolveByPath(segments)) {
    res.status(405).end(); // already exists
    return;
  }
  files.createFolder(target.parent.id, target.name);
  res.status(201).end();
}

async function handleDelete(req: Request, res: Response): Promise<void> {
  const node = dav.resolveByPath(dav.splitPath(req.path));
  if (!node) {
    res.status(404).end();
    return;
  }
  if (node.id === ROOT_ID) {
    res.status(403).end();
    return;
  }
  await files.remove(node.id);
  res.status(204).end();
}

async function handleMove(req: Request, res: Response): Promise<void> {
  const node = dav.resolveByPath(dav.splitPath(req.path));
  if (!node) {
    res.status(404).end();
    return;
  }
  if (node.id === ROOT_ID) {
    res.status(403).end();
    return;
  }
  const destSegments = parseDestination(req);
  if (!destSegments) {
    res.status(400).end();
    return;
  }
  const dest = dav.resolveParentAndName(destSegments);
  if (!dest) {
    res.status(409).end();
    return;
  }
  const existingDest = dav.resolveByPath(destSegments);
  const created = !existingDest;
  if (existingDest) {
    if (!wantsOverwrite(req)) {
      res.status(412).end();
      return;
    }
    if (existingDest.id !== node.id) await files.remove(existingDest.id);
  }
  files.relocate(node.id, dest.parent.id, dest.name);
  res.status(created ? 201 : 204).end();
}

async function handleCopy(req: Request, res: Response): Promise<void> {
  const node = dav.resolveByPath(dav.splitPath(req.path));
  if (!node) {
    res.status(404).end();
    return;
  }
  const destSegments = parseDestination(req);
  if (!destSegments) {
    res.status(400).end();
    return;
  }
  const dest = dav.resolveParentAndName(destSegments);
  if (!dest) {
    res.status(409).end();
    return;
  }
  const overwrite = wantsOverwrite(req);
  const created = !dav.resolveByPath(destSegments);
  if (!created && !overwrite) {
    res.status(412).end();
    return;
  }
  await files.copyNode(node.id, dest.parent.id, dest.name, overwrite);
  res.status(created ? 201 : 204).end();
}

function handleProppatch(req: Request, res: Response): void {
  // Accept and no-op (e.g. Windows setting Win32 file times), reporting success per property set.
  const href = `${req.baseUrl}${req.path}`;
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:"><D:response>` +
    `<D:href>${href}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status></D:propstat>` +
    `</D:response></D:multistatus>`;
  res.status(207).setHeader('Content-Type', 'application/xml; charset=utf-8').send(xml);
}

function handleLock(_req: Request, res: Response): void {
  const token = lockStore.create();
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>` +
    `<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>` +
    `<D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout>` +
    `<D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`;
  res
    .status(200)
    .setHeader('Lock-Token', `<${token}>`)
    .setHeader('Content-Type', 'application/xml; charset=utf-8')
    .send(xml);
}

function handleUnlock(_req: Request, res: Response): void {
  res.status(204).end();
}

// ---- wiring: auth, then dispatch by method ----
webdavRouter.use(davBasicAuth);
webdavRouter.use(
  asyncHandler(async (req: Request, res: Response) => {
    switch (req.method) {
      case 'OPTIONS':
        return handleOptions(req, res);
      case 'PROPFIND':
        return handlePropfind(req, res);
      case 'GET':
      case 'HEAD':
        return handleGet(req, res);
      case 'PUT':
        return handlePut(req, res);
      case 'MKCOL':
        return handleMkcol(req, res);
      case 'DELETE':
        return handleDelete(req, res);
      case 'MOVE':
        return handleMove(req, res);
      case 'COPY':
        return handleCopy(req, res);
      case 'PROPPATCH':
        return handleProppatch(req, res);
      case 'LOCK':
        return handleLock(req, res);
      case 'UNLOCK':
        return handleUnlock(req, res);
      default:
        res.status(405).setHeader('Allow', ALLOW).end();
        return;
    }
  }),
);
