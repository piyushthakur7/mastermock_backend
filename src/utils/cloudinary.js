import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

// Configure Cloudinary
if (
  env.CLOUDINARY_CLOUD_NAME &&
  env.CLOUDINARY_API_KEY &&
  env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
} else {
  console.warn('Cloudinary is not configured. Mocking upload.');
}

/**
 * Uploads a file buffer to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - The filename or public ID to use
 * @returns {Promise<string>} - Returns the public_id of the uploaded file
 */
export const uploadFileToCloudinary = async (fileBuffer, fileName) => {
  try {
    if (
      !env.CLOUDINARY_CLOUD_NAME ||
      !env.CLOUDINARY_API_KEY ||
      !env.CLOUDINARY_API_SECRET
    ) {
      // Previously returned a fake `mock_cloudinary_id_...` and reported
      // success. Any caller then wrote a database record whose file had never
      // been stored anywhere — a resource that looks downloadable forever and
      // 404s every time. Fail loudly instead.
      throw new ApiError(
        500,
        'File storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
      );
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: fileName,
          resource_type: 'auto',
          type: 'authenticated', // Make it private so it requires signature
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary Upload Error:', error);
            return reject(
              new ApiError(500, 'Failed to upload file to Cloudinary'),
            );
          }
          resolve(result.public_id);
        },
      );

      uploadStream.end(fileBuffer);
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('Cloudinary Upload Error:', error);
    throw new ApiError(500, 'Failed to upload file to Cloudinary');
  }
};

/**
 * Deletes a file from Cloudinary using its public_id
 * @param {string} publicId - The Cloudinary public_id
 */
export const deleteFileFromCloudinary = async (publicId) => {
  try {
    if (
      !env.CLOUDINARY_CLOUD_NAME ||
      !env.CLOUDINARY_API_KEY ||
      !env.CLOUDINARY_API_SECRET
    ) {
      return; // nothing was ever stored there
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      type: 'authenticated',
    });
    if (result.result !== 'ok' && result.result !== 'not found') {
      console.warn('Cloudinary Delete Warning:', result);
    }
  } catch (error) {
    console.error('Cloudinary Delete Error:', error);
    throw new ApiError(500, 'Failed to delete file from Cloudinary');
  }
};
