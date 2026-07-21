import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

/**
 * Uploads a file buffer to local storage
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - The filename (can include path)
 * @returns {Promise<string>} - Returns the relative file path
 */
export const uploadFileLocally = async (fileBuffer, fileName) => {
  try {
    const fullPath = path.join(UPLOAD_DIR, fileName);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await fs.promises.mkdir(dir, { recursive: true });

    // Write file
    await fs.promises.writeFile(fullPath, fileBuffer);

    return fileName;
  } catch (error) {
    console.error('Local File Upload Error:', error);
    throw new ApiError(500, 'Failed to save file locally');
  }
};

/**
 * Deletes a file from local storage
 * @param {string} fileName - The relative file path
 */
export const deleteFileLocally = async (fileName) => {
  try {
    const fullPath = path.join(UPLOAD_DIR, fileName);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  } catch (error) {
    console.error('Local File Delete Error:', error);
    throw new ApiError(500, 'Failed to delete file locally');
  }
};
