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

/**
 * Generates a signed download URL for a local file
 * @param {string} fileName - The relative file path
 * @param {object} req - Express request object
 * @returns {Promise<string>}
 */
export const generateSignedDownloadUrl = async (fileName, req) => {
  try {
    // Generate a signed token valid for 1 hour
    const token = jwt.sign({ file: fileName }, env.ACCESS_TOKEN_SECRET, {
      expiresIn: '1h',
    });

    // Determine protocol considering proxy servers (e.g., behind Nginx/Vercel)
    let protocol = req.protocol;
    if (req.headers['x-forwarded-proto']) {
      protocol = req.headers['x-forwarded-proto'].split(',')[0].trim();
    }

    const host = req.get('host');

    return `${protocol}://${host}/api/v1/resources/serve?token=${token}`;
  } catch (error) {
    console.error('Signed URL Generation Error:', error);
    throw new ApiError(500, 'Failed to generate download URL');
  }
};
