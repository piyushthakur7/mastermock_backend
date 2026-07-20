import { Resource } from '../models/resource.model.js';
import { Course } from '../models/course.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadFileLocally, deleteFileLocally } from '../utils/fileStorage.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import fs from 'fs';
import crypto from 'crypto';

// @desc    Upload a new resource
// @route   POST /api/v1/resources
// @access  Private/Admin
export const uploadResource = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    course,
    category,
    resource_type,
    access_type,
    price,
    discount_price,
  } = req.body;

  // Validate course reference if provided
  if (course) {
    const courseExists = await Course.findById(course);
    if (!courseExists) {
      throw new ApiError(404, 'Course not found');
    }
  }

  if (!req.file) {
    throw new ApiError(400, 'File is required');
  }

  // Generate unique filename
  const uniqueSuffix = crypto.randomBytes(8).toString('hex');
  const folder = course || 'standalone';
  const fileName = `resources/${folder}/${resource_type}_${uniqueSuffix}_${req.file.originalname}`;

  // Upload locally
  const publicId = await uploadFileLocally(req.file.buffer, fileName);

  const resource = await Resource.create({
    title,
    description,
    course: course || undefined,
    category: category || undefined,
    resource_type,
    access_type: access_type || 'free',
    price: price || 0,
    discount_price,
    file_url: publicId, // Storing the Cloudinary publicId here for signed URLs later
    created_by: req.user._id,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, resource, 'Resource uploaded successfully'));
});

// @desc    Delete a resource
// @route   DELETE /api/v1/resources/:id
// @access  Private/Admin
export const deleteResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);

  if (!resource) {
    throw new ApiError(404, 'Resource not found');
  }

  // Delete from local storage
  await deleteFileLocally(resource.file_url);

  // Hard delete from DB as it's just a file reference
  await resource.deleteOne();

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Resource deleted successfully'));
});

// @desc    Get all resources (standalone PDFs) — login required, no enrollment check
// @route   GET /api/v1/resources
// @access  Private/Student
export const getAllResources = asyncHandler(async (req, res) => {
  const filter = { isDeleted: false, is_active: true };

  // Optional filtering by category or resource_type
  if (req.query.category) filter.category = req.query.category;
  if (req.query.resource_type) filter.resource_type = req.query.resource_type;
  if (req.query.access_type) filter.access_type = req.query.access_type;

  const resources = await Resource.find(filter)
    .populate('category', 'name')
    .populate('course', 'title')
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, resources, 'Resources fetched successfully'));
});

// @desc    Get resources for a course (backward compatible)
// @route   GET /api/v1/resources/course/:courseId
// @access  Private/Student
export const getCourseResources = asyncHandler(async (req, res) => {
  const courseId = req.params.courseId;
  const course = await Course.findById(courseId);
  if (!course) {
    throw new ApiError(404, 'Course not found');
  }

  const resources = await Resource.find({
    course: courseId,
    isDeleted: false,
    is_active: true,
  }).sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, resources, 'Resources fetched successfully'));
});

// @desc    Download a resource (PDF) directly
// @route   GET /api/v1/resources/:id/download
// @access  Private/Student
export const downloadResource = asyncHandler(async (req, res) => {
  if (!req.params.id || !req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
    logger.error(
      JSON.stringify({
        event: 'DOWNLOAD_FAILED',
        reason: 'Invalid file ID',
        userId: req.user?._id,
        fileId: req.params.id,
        url: req.originalUrl,
        method: req.method,
      }),
    );
    throw new ApiError(400, 'Invalid file ID');
  }

  const resource = await Resource.findById(req.params.id);

  if (!resource) {
    logger.error(
      JSON.stringify({
        event: 'DOWNLOAD_FAILED',
        reason: 'Database record missing',
        userId: req.user?._id,
        fileId: req.params.id,
        url: req.originalUrl,
        method: req.method,
      }),
    );
    throw new ApiError(404, 'Database record missing');
  }

  if (resource.isDeleted || !resource.is_active) {
    logger.error(
      JSON.stringify({
        event: 'DOWNLOAD_FAILED',
        reason: 'File deleted',
        userId: req.user?._id,
        fileId: req.params.id,
        url: req.originalUrl,
        method: req.method,
      }),
    );
    throw new ApiError(403, 'File deleted');
  }

  if (!resource.file_url) {
    logger.error(
      JSON.stringify({
        event: 'DOWNLOAD_FAILED',
        reason: 'Storage path missing',
        userId: req.user?._id,
        fileId: req.params.id,
        url: req.originalUrl,
        method: req.method,
      }),
    );
    throw new ApiError(404, 'Storage path missing');
  }

  const fullPath = path.join(process.cwd(), 'uploads', resource.file_url);

  if (!fs.existsSync(fullPath)) {
    logger.error(
      JSON.stringify({
        event: 'DOWNLOAD_FAILED',
        reason: 'File not found',
        userId: req.user?._id,
        fileId: resource._id,
        storagePath: resource.file_url,
        url: req.originalUrl,
        method: req.method,
      }),
    );
    throw new ApiError(404, 'File not found');
  }

  // Set headers for download
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${resource.title}.pdf"`,
  );
  res.setHeader('Content-Type', 'application/pdf');

  // Track download duration
  const startTime = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(startTime);
    const duration = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2) + 'ms';

    logger.info(
      JSON.stringify({
        event: 'DOWNLOAD_COMPLETE',
        correlationId: req.correlationId || 'none',
        userId: req.user._id,
        fileId: resource._id,
        fileName: resource.title,
        storagePath: resource.file_url,
        url: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        fileExists: true,
        duration,
      }),
    );
  });

  res.on('error', (err) => {
    logger.error(
      JSON.stringify({
        event: 'DOWNLOAD_FAILED',
        reason: 'Stream error',
        userId: req.user?._id,
        fileId: resource._id,
        storagePath: resource.file_url,
        url: req.originalUrl,
        method: req.method,
        errorStack: err.stack,
      }),
    );
  });

  // Stream directly to response
  const fileStream = fs.createReadStream(fullPath);
  fileStream.pipe(res);
});
