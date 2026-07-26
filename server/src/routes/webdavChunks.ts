import { Router, type Request, type Response } from 'express';
import { davBasicAuth } from '../middleware/davAuth';
import { asyncHandler } from '../util/asyncHandler';
import * as chunks from '../services/chunks';
import * as dav from '../services/webdav';
import * as files from '../services/files';
import { BadRequestError } from '../util/errors';

/**
 * Chunked-upload endpoint implementing the Nextcloud protocol that rclone speaks
 * (`vendor = nextcloud`). Mounted at `/remote.php/dav/uploads/:user`.
 *
 * The client:
 *   1. MKCOL  /<session>                       — open an upload session
 *   2. PUT    /<session>/<start>-<end>         — one request per chunk (small!)
 *   3. MOVE   /<session>/.file  + Destination  — assemble into the real file
 *
 * Because every request carries only one chunk, arbitrarily large files can be uploaded
 * through proxies that cap request bodies (e.g. Cloudflare). The assembled stream is handed
 * to the normal storage engine, so placement/quota see the true total size.
 */
export const webdavChunksRouter = Router();

const ALLOW = 'OPTIONS, PROPFIND, MKCOL, PUT, MOVE, DELETE';

/**
 * Extract the logical file path from a Destination header pointing into the files endpoint,
 * i.e. everything after `/dav/files/<user>` (matching how rclone builds the destination).
 */
function destinationSegments(req: Request): string[] | null {
  const dest = req.headers.destination;
  if (typeof dest !== 'string') return null;
  let pathname: string;
  try {
    pathname = new URL(dest, `http://${req.headers.host ?? 'localhost'}`).pathname;
  } catch {
    pathname = dest;
  }
  const match = /\/dav\/files\/[^/]+(\/.*)?$/.exec(pathname);
  if (!match) return null;
  return dav.splitPath(match[1] ?? '');
}

async function handleMove(req: Request, res: Response, session: string): Promise<void> {
  const segments = destinationSegments(req);
  if (!segments || segments.length === 0) {
    res.status(400).send('Missing or invalid Destination header.');
    return;
  }
  const target = dav.resolveParentAndName(segments);
  if (!target) {
    res.status(409).send('Destination folder does not exist.');
    return;
  }

  const { paths, totalSize } = await chunks.sessionParts(session);
  if (paths.length === 0) {
    res.status(400).send('Upload session has no chunks.');
    return;
  }

  const created = !dav.resolveByPath(segments);
  // Assemble by streaming the chunks in order; the engine picks a backend using totalSize.
  await files.writeFileAtPath({
    parentId: target.parent.id,
    name: target.name,
    stream: chunks.concatStream(paths),
    size: totalSize,
  });
  await chunks.destroySession(session);
  res.status(created ? 201 : 204).end();
}

webdavChunksRouter.use(davBasicAuth);
webdavChunksRouter.use(
  asyncHandler(async (req: Request, res: Response) => {
    const segments = dav.splitPath(req.path);

    if (req.method === 'OPTIONS') {
      res.setHeader('DAV', '1, 2');
      res.setHeader('Allow', ALLOW);
      res.status(200).end();
      return;
    }

    if (segments.length === 0) {
      // The uploads collection itself; report it exists so clients can probe it.
      res.status(req.method === 'PROPFIND' ? 207 : 405).end();
      return;
    }

    const [session, part] = segments;

    switch (req.method) {
      case 'MKCOL':
        if (segments.length !== 1) throw new BadRequestError('Invalid upload session path.');
        await chunks.createSession(session);
        res.status(201).end();
        return;

      case 'PUT':
        if (segments.length !== 2) throw new BadRequestError('Invalid chunk path.');
        await chunks.writeChunk(session, part, req);
        res.status(201).end();
        return;

      case 'MOVE':
        // rclone finalizes by MOVEing the session's virtual ".file" to the destination.
        if (segments.length !== 2) throw new BadRequestError('Invalid finalize path.');
        await handleMove(req, res, session);
        return;

      case 'DELETE':
        await chunks.destroySession(session);
        res.status(204).end();
        return;

      case 'PROPFIND':
        res.status(chunks.sessionExists(session) ? 207 : 404).end();
        return;

      default:
        res.status(405).setHeader('Allow', ALLOW).end();
        return;
    }
  }),
);
