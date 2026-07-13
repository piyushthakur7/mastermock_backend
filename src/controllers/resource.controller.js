import { Resource } from '../models/resource.model.js';
import { Course } from '../models/course.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  uploadFileToCloudinary,
  deleteFileFromCloudinary,
  generateSignedDownloadUrl,
} from '../utils/cloudinary.js';
import path from 'path';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import fs from 'fs';
import crypto from 'crypto';

// @desc    Upload a new resource
// @route   POST /api/v1/resources
// @access  Private/Admin
export const uploadResource = asyncHandler(async (req, res) => {
  const { title, description, course, category, resource_type } = req.body;

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

  // Upload to Cloudinary (using resource_type: auto to support PDFs)
  const publicId = await uploadFileToCloudinary(req.file.buffer, fileName);

  const resource = await Resource.create({
    title,
    description,
    course: course || undefined,
    category: category || undefined,
    resource_type,
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

  // Delete from Cloudinary
  await deleteFileFromCloudinary(resource.file_url);

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

// @desc    Get signed download URL for a resource
// @route   GET /api/v1/resources/:id/download
// @access  Private/Student (all PDFs are free for logged-in users)
export const downloadResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findOne({
    _id: req.params.id,
    isDeleted: false,
    is_active: true,
  });

  if (!resource) {
    throw new ApiError(404, 'Resource not found');
  }

  // All PDFs are free for logged-in users — no enrollment check needed

  // Generate signed URL from Cloudinary
  const signedUrl = await generateSignedDownloadUrl(resource.file_url);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { downloadUrl: signedUrl },
        'Signed URL generated successfully',
      ),
    );
});

// @desc    Serve a resource file directly via token
// @route   GET /api/v1/resources/serve?token=...
// @access  Public (Token verified)
export const serveResource = asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token) {
    throw new ApiError(400, 'Download token is required');
  }

  try {
    const decodedToken = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
    const fileName = decodedToken.file;

    if (!fileName) {
      throw new ApiError(400, 'Invalid download token');
    }

    const fullPath = path.join(process.cwd(), 'uploads', fileName);

    if (!fs.existsSync(fullPath)) {
      throw new ApiError(404, 'File not found on server');
    }

    res.download(fullPath);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Download link has expired');
    }
    throw new ApiError(401, 'Invalid download token');
  }
});
