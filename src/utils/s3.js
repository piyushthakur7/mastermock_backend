import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

let s3Client;

try {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    s3Client = new S3Client({
      region: env.AWS_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
} catch (err) {
  console.warn('Failed to initialize S3 client');
}

export const uploadFileToS3 = async (fileBuffer, fileName, mimetype) => {
  try {
    if (!s3Client || !env.AWS_S3_BUCKET_NAME) {
      console.warn('S3 not configured. Mocking upload.');
      return `mock_s3_key_${Date.now()}_${fileName}`;
    }

    const params = {
      Bucket: env.AWS_S3_BUCKET_NAME,
      Key: fileName,
      Body: fileBuffer,
      ContentType: mimetype,
    };

    await s3Client.send(new PutObjectCommand(params));
    return fileName;
  } catch (error) {
    console.error('S3 Upload Error:', error);
    throw new ApiError(500, 'Failed to upload file to S3');
  }
};

export const deleteFileFromS3 = async (fileKey) => {
  try {
    if (
      !s3Client ||
      !env.AWS_S3_BUCKET_NAME ||
      fileKey.startsWith('mock_s3_key_')
    )
      return true;

    const params = {
      Bucket: env.AWS_S3_BUCKET_NAME,
      Key: fileKey,
    };

    await s3Client.send(new DeleteObjectCommand(params));
    return true;
  } catch (error) {
    console.error('S3 Delete Error:', error);
    throw new ApiError(500, 'Failed to delete file from S3');
  }
};

export const generateSignedDownloadUrl = async (fileKey) => {
  try {
    if (
      !s3Client ||
      !env.AWS_S3_BUCKET_NAME ||
      fileKey.startsWith('mock_s3_key_')
    ) {
      return `https://mock-s3-url.com/download/${fileKey}`;
    }

    const command = new GetObjectCommand({
      Bucket: env.AWS_S3_BUCKET_NAME,
      Key: fileKey,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });
    return signedUrl;
  } catch (error) {
    console.error('S3 Presign Error:', error);
    throw new ApiError(500, 'Failed to generate signed URL');
  }
};
