import { Resource } from '../models/resource.model.js';
import { Course } from '../models/course.model.js';
import { Enrollment } from '../models/enrollment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  uploadFileToCloudinary,
  deleteFileFromCloudinary,
  generateSignedDownloadUrl,
} from '../utils/cloudinary.js';
import crypto from 'crypto';

// @desc    Upload a new resource
// @route   POST /api/v1/resources
// @access  Private/Admin
export const uploadResource = asyncHandler(async (req, res) => {
  const { title, description, course, resource_type } = req.body;

  const courseExists = await Course.findById(course);
  if (!courseExists) {
    throw new ApiError(404, 'Course not found');
  }

  if (!req.file) {
    throw new ApiError(400, 'File is required');
  }

  // Generate unique filename
  const uniqueSuffix = crypto.randomBytes(8).toString('hex');
  const fileName = `resources/${course}/${resource_type}_${uniqueSuffix}_${req.file.originalname}`;

  // Upload to Cloudinary
  const publicId = await uploadFileToCloudinary(
    req.file.buffer,
    fileName
  );

  const resource = await Resource.create({
    title,
    description,
    course,
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

// @desc    Get resources for a course
// @route   GET /api/v1/resources/course/:courseId
// @access  Private/Student
export const getCourseResources = asyncHandler(async (req, res) => {
  const courseId = req.params.courseId;
  const course = await Course.findById(courseId);
  if (!course) {
    throw new ApiError(404, 'Course not found');
  }

  if (req.user.role !== 'ADMIN') {
    const enrollment = await Enrollment.findOne({
      user: req.user._id,
      course: courseId,
      status: 'ACTIVE',
    });
    if (!enrollment) {
      throw new ApiError(403, 'Active enrollment required to access resources');
    }
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
// @access  Private/Student
export const downloadResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findOne({
    _id: req.params.id,
    isDeleted: false,
    is_active: true,
  });

  if (!resource) {
    throw new ApiError(404, 'Resource not found');
  }

  if (req.user.role !== 'ADMIN') {
    const enrollment = await Enrollment.findOne({
      user: req.user._id,
      course: resource.course,
      status: 'ACTIVE',
    });
    if (!enrollment) {
      throw new ApiError(
        403,
        'Active enrollment required to download resources',
      );
    }
  }

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
