import { Resource } from '../models/resource.model.js';
import { Course } from '../models/course.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  saveFile,
  getFile,
  deleteFile,
  fileExists,
} from '../utils/fileStorage.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';
import path from 'path';

const storageKeyFor = (folder, resourceType, originalName) =>
  `resources/${folder || 'standalone'}/${resourceType}_${crypto
    .randomBytes(8)
    .toString('hex')}_${originalName}`;

// Every listing says whether the bytes are actually there. A record can
// outlive its file (that is how the PDF library emptied out without anything
// noticing), and the only symptom was a student's download failing. With this
// the student page can mark the PDF unavailable instead of offering a button
// that errors, and the admin page can show exactly which ones need re-upload.
const withAvailability = (resource) => ({
  ...resource.toObject(),
  file_available: Boolean(resource.file_url) && fileExists(resource.file_url),
});

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

  const storageKey = storageKeyFor(
    course,
    resource_type,
    req.file.originalname,
  );

  // Persist the bytes in the SQLite blob store
  saveFile(req.file.buffer, storageKey, {
    originalName: req.file.originalname,
    mimeType: req.file.mimetype || 'application/pdf',
  });

  const resource = await Resource.create({
    title,
    description,
    course: course || undefined,
    category: category || undefined,
    resource_type,
    access_type: access_type || 'free',
    price: price || 0,
    discount_price,
    file_url: storageKey, // Key into the SQLite blob store, not a URL
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

  // Record first, bytes second. The other order loses the PDF and then leaves
  // the record behind if the Mongo delete fails — a resource that still lists
  // for students but 404s on download. This way a failure leaves an unreferenced
  // blob, which wastes a little space and nothing else.
  await resource.deleteOne();
  deleteFile(resource.file_url);

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Resource deleted successfully'));
});

// @desc    Replace the file behind an existing resource
// @route   PUT /api/v1/resources/:id/file
// @access  Private/Admin
//
// For a resource whose bytes were lost. Uploading it again as a new resource
// leaves the broken record listed beside the new one; this puts the file back
// under the record students already see, keeping its title, category and date.
export const replaceResourceFile = asyncHandler(async (req, res) => {
  const resource = await Resource.findOne({
    _id: req.params.id,
    isDeleted: false,
  });
  if (!resource) {
    throw new ApiError(404, 'Resource not found');
  }

  if (!req.file) {
    throw new ApiError(400, 'File is required');
  }

  const previousKey = resource.file_url;
  const storageKey = storageKeyFor(
    resource.course?.toString(),
    resource.resource_type,
    req.file.originalname,
  );

  // New bytes first, then point the record at them, then drop the old bytes.
  // A failure part way leaves at worst an unreferenced blob, never a record
  // pointing at nothing.
  saveFile(req.file.buffer, storageKey, {
    originalName: req.file.originalname,
    mimeType: req.file.mimetype || 'application/pdf',
  });
  resource.file_url = storageKey;
  await resource.save();
  if (previousKey && previousKey !== storageKey) deleteFile(previousKey);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        withAvailability(resource),
        'Resource file replaced successfully',
      ),
    );
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
    .json(
      new ApiResponse(
        200,
        resources.map(withAvailability),
        'Resources fetched successfully',
      ),
    );
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
    .json(
      new ApiResponse(
        200,
        resources.map(withAvailability),
        'Resources fetched successfully',
      ),
    );
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

  const file = getFile(resource.file_url);

  if (!file) {
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
    // Shown to the student as-is, so say what it means for them.
    throw new ApiError(
      404,
      'This PDF is temporarily unavailable while it is being re-uploaded. Please check back soon.',
    );
  }

  // Name the download after the resource title, keeping the real extension —
  // hardcoding .pdf mislabels the video and notes resource types, and doubles
  // the suffix on a title that already ends in one.
  const extension =
    path.extname(file.original_name || '').toLowerCase() || '.pdf';
  const title = resource.title.trim();
  const stem = title.toLowerCase().endsWith(extension)
    ? title.slice(0, -extension.length)
    : title;
  const downloadName = `${stem}${extension}`;

  // Two filenames on purpose. A quote, newline or non-ASCII byte in the title
  // would break out of the quoted form and corrupt the response headers, so
  // that one stays strictly ASCII; filename* carries the title intact (Hindi
  // titles reduce to a row of underscores otherwise) and is what every current
  // browser actually reads. encodeURIComponent escapes CR and LF, so the
  // header cannot be split there either.
  const asciiName =
    downloadName.replace(/[^\w\-. ]/g, '_').trim() || `download${extension}`;

  // Set headers for download
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
  );
  res.setHeader('Content-Type', file.mime_type || 'application/pdf');
  res.setHeader('Content-Length', file.size);

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
        reason: 'Write error',
        userId: req.user?._id,
        fileId: resource._id,
        storagePath: resource.file_url,
        url: req.originalUrl,
        method: req.method,
        errorStack: err.stack,
      }),
    );
  });

  res.end(file.data);
});
