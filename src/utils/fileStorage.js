import { db } from '../db/sqliteStore.js';
import { ApiError } from './ApiError.js';

// better-sqlite3 is synchronous by design; these statements are prepared once
// and reused for every call.
const insertFile = db.prepare(
  `INSERT INTO resource_files (storage_key, original_name, mime_type, size, data)
   VALUES (@storage_key, @original_name, @mime_type, @size, @data)`,
);

const selectFile = db.prepare(
  `SELECT storage_key, original_name, mime_type, size, data
   FROM resource_files WHERE storage_key = ?`,
);

const selectFileMeta = db.prepare(
  `SELECT storage_key, original_name, mime_type, size
   FROM resource_files WHERE storage_key = ?`,
);

const deleteFileRow = db.prepare(
  `DELETE FROM resource_files WHERE storage_key = ?`,
);

/**
 * Stores a file's bytes in the SQLite blob store.
 * @param {Buffer} fileBuffer - The file contents
 * @param {string} storageKey - Unique key used to retrieve the file later
 * @param {object} meta
 * @param {string} meta.originalName - Original client filename
 * @param {string} meta.mimeType - Content type to serve the file back with
 * @returns {string} The storage key
 */
export const saveFile = (
  fileBuffer,
  storageKey,
  { originalName, mimeType },
) => {
  try {
    insertFile.run({
      storage_key: storageKey,
      original_name: originalName,
      mime_type: mimeType,
      size: fileBuffer.length,
      data: fileBuffer,
    });
    return storageKey;
  } catch (error) {
    console.error('SQLite File Save Error:', error);
    throw new ApiError(500, 'Failed to save file');
  }
};

/**
 * Reads a file back out of the store.
 * @param {string} storageKey
 * @returns {{storage_key: string, original_name: string, mime_type: string, size: number, data: Buffer}|undefined}
 */
export const getFile = (storageKey) => selectFile.get(storageKey);

/**
 * Checks a file exists without pulling its bytes into memory.
 * @param {string} storageKey
 * @returns {boolean}
 */
export const fileExists = (storageKey) =>
  Boolean(selectFileMeta.get(storageKey));

/**
 * Removes a file from the store.
 * @param {string} storageKey
 */
export const deleteFile = (storageKey) => {
  try {
    deleteFileRow.run(storageKey);
  } catch (error) {
    console.error('SQLite File Delete Error:', error);
    throw new ApiError(500, 'Failed to delete file');
  }
};
