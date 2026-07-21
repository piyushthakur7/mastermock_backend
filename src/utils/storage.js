import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';
import { logger } from './logger.js';

/**
 * File storage with a durable backend when one is configured, and honest
 * failure when it is not.
 *
 * Background: resources were written to a local `uploads/` directory. On a
 * host that rebuilds the container on deploy that directory is wiped, while
 * the MongoDB records survive — so the catalogue kept advertising PDFs whose
 * bytes no longer existed, and every download 404'd. The existing
 * cloudinary/s3 helpers made it worse: when unconfigured they returned a fake
 * `mock_..._id` and reported success, creating a record that never had a file
 * behind it at all.
 *
 * Rules here:
 *   - Never fabricate a successful upload. If a store cannot accept the file,
 *     the request fails and no database record is written.
 *   - Downloads always go through the API so access gating cannot be bypassed
 *     by handing the client a direct URL.
 */

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

export const LOCAL = 'local';
export const CLOUDINARY = 'cloudinary';

export const isCloudinaryConfigured = () =>
  Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET,
  );

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/** Which store new uploads go to. */
export const activeProvider = () =>
  isCloudinaryConfigured() ? CLOUDINARY : LOCAL;

/**
 * Is the active store durable across a redeploy?
 *
 * Local disk is not, on any platform that rebuilds the filesystem. Surfaced so
 * the admin UI and startup logs can say so out loud rather than letting files
 * disappear quietly.
 */
export const isDurable = () => activeProvider() !== LOCAL;

export const sanitizeFileName = (name) => {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'file';
};

/**
 * Resolve a local relative key to an absolute path, refusing to escape
 * UPLOAD_DIR. path.resolve() collapses `..` first, so this is a real
 * containment check rather than a string-prefix guess.
 */
export const resolveLocalPath = (relativePath) => {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new ApiError(400, 'Invalid file path');
  }

  const fullPath = path.resolve(UPLOAD_DIR, relativePath);

  if (fullPath !== UPLOAD_DIR && !fullPath.startsWith(UPLOAD_DIR + path.sep)) {
    throw new ApiError(400, 'Invalid file path');
  }

  return fullPath;
};

// ─── Upload ─────────────────────────────────────────────────────────

const putLocal = async (buffer, key) => {
  const fullPath = resolveLocalPath(key);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, buffer);

  // Read back the size and confirm the bytes actually landed. A silently
  // truncated or failed write is what leaves a record pointing at nothing.
  const stat = await fs.promises.stat(fullPath);
  if (stat.size !== buffer.length) {
    await fs.promises.unlink(fullPath).catch(() => {});
    throw new ApiError(500, 'File was not written correctly. Please retry.');
  }

  return { key, provider: LOCAL, size: stat.size };
};

// Content type is inferred by Cloudinary via `resource_type: 'auto'`, so the
// caller's mimetype is not needed here — it is stored on the record instead
// and replayed as the Content-Type header on download.
const putCloudinary = (buffer, key) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        // Strip the extension: Cloudinary appends its own via format.
        public_id: key.replace(/\.[^./]+$/, ''),
        resource_type: 'auto',
        type: 'upload',
        overwrite: false,
      },
      (error, result) => {
        if (error || !result?.public_id) {
          logger.error(`Cloudinary upload failed: ${error?.message}`);
          return reject(
            new ApiError(
              502,
              'The file store rejected the upload. Please retry.',
            ),
          );
        }
        resolve({
          key: result.public_id,
          provider: CLOUDINARY,
          size: result.bytes,
          resource_type: result.resource_type,
          format: result.format,
          url: result.secure_url,
        });
      },
    );

    Readable.from(buffer).pipe(uploadStream);
  });

/**
 * Store a file. Resolves only if the bytes are genuinely persisted.
 */
export const putFile = async (buffer, key) => {
  if (!buffer?.length) {
    throw new ApiError(400, 'The uploaded file is empty');
  }

  return activeProvider() === CLOUDINARY
    ? putCloudinary(buffer, key)
    : putLocal(buffer, key);
};

// ─── Existence ──────────────────────────────────────────────────────

/**
 * Does the file behind this record actually exist?
 *
 * Cheap for local (a stat). For Cloudinary this trusts the record rather than
 * making an API call per resource — listing endpoints would otherwise fire one
 * network round trip per row.
 */
export const fileExists = async (resource) => {
  if (!resource?.file_url) return false;

  const provider = resource.storage_provider || LOCAL;
  if (provider !== LOCAL) return true;

  try {
    await fs.promises.access(resolveLocalPath(resource.file_url));
    return true;
  } catch {
    return false;
  }
};

/** Synchronous variant for shaping list responses. */
export const fileExistsSync = (resource) => {
  if (!resource?.file_url) return false;

  const provider = resource.storage_provider || LOCAL;
  if (provider !== LOCAL) return true;

  try {
    return fs.existsSync(resolveLocalPath(resource.file_url));
  } catch {
    return false;
  }
};

// ─── Read ───────────────────────────────────────────────────────────

/**
 * Open a readable stream for the stored file.
 *
 * Cloudinary content is proxied through the API rather than redirecting the
 * client, so the paid-resource access check cannot be sidestepped and the
 * browser never makes a cross-origin request for the bytes.
 */
export const openReadStream = async (resource) => {
  const provider = resource.storage_provider || LOCAL;

  if (provider === LOCAL) {
    const fullPath = resolveLocalPath(resource.file_url);
    if (!fs.existsSync(fullPath)) return null;
    return { stream: fs.createReadStream(fullPath), size: resource.file_size };
  }

  const url =
    resource.file_public_url ||
    cloudinary.url(resource.file_url, { secure: true, resource_type: 'auto' });

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    logger.error(
      `Upstream file store returned ${response.status} for resource=${resource._id}`,
    );
    return null;
  }

  return {
    stream: Readable.fromWeb(response.body),
    size: Number(response.headers.get('content-length')) || resource.file_size,
  };
};

// ─── Delete ─────────────────────────────────────────────────────────

export const removeFile = async (resource) => {
  const provider = resource?.storage_provider || LOCAL;
  if (!resource?.file_url) return;

  if (provider === LOCAL) {
    let fullPath;
    try {
      fullPath = resolveLocalPath(resource.file_url);
    } catch {
      return; // stored path no longer resolves inside uploads/
    }
    try {
      await fs.promises.unlink(fullPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return;
  }

  await cloudinary.uploader.destroy(resource.file_url, {
    resource_type: 'raw',
    type: 'upload',
  });
};
