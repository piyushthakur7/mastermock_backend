import { Resource } from '../models/resource.model.js';
import { Course } from '../models/course.model.js';
import { Purchase } from '../models/purchase.model.js';
import { Enrollment } from '../models/enrollment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  putFile,
  removeFile,
  openReadStream,
  fileExistsSync,
  sanitizeFileName,
  activeProvider,
  isDurable,
} from '../utils/storage.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import crypto from 'crypto';

const logDownloadFailure = (req, reason, extra = {}) =>
  logger.error(
    JSON.stringify({
      event: 'DOWNLOAD_FAILED',
      reason,
      correlationId: req.correlationId || 'none',
      userId: req.user?._id,
      fileId: req.params.id,
      url: req.originalUrl,
      method: req.method,
      ...extra,
    }),
  );

/**
 * Can this user download this resource?
 *
 * downloadResource previously performed no access check whatsoever: it read
 * access_type and price nowhere, so any logged-in student could list the paid
 * catalogue via GET /resources?access_type=paid and download every item.
 */
const canAccessResource = async (resource, user) => {
  if (user.role === 'ADMIN') return true;
  if (resource.access_type !== 'paid') return true;

  const directPurchase = await Purchase.findOne({
    user: user._id,
    item_id: resource._id,
    item_type: 'Resource',
    status: 'ACTIVE',
  });
  if (directPurchase) return true;

  // A resource attached to a course is unlocked by owning that course.
  if (resource.course) {
    const [enrollment, coursePurchase] = await Promise.all([
      Enrollment.findOne({
        user: user._id,
        course: resource.course,
        status: 'ACTIVE',
      }),
      Purchase.findOne({
        user: user._id,
        item_id: resource.course,
        item_type: 'Course',
        status: 'ACTIVE',
      }),
    ]);
    if (enrollment || coursePurchase) return true;
  }

  return false;
};

/**
 * Add availability to a listed resource.
 *
 * The catalogue used to advertise every record as downloadable regardless of
 * whether its bytes still existed, so a missing file only revealed itself as a
 * failed download after the student clicked. `file_available` lets the UI show
 * the real state up front.
 */
const shapeResource = (resource) => {
  const obj =
    typeof resource.toObject === 'function' ? resource.toObject() : resource;
  return { ...obj, file_available: fileExistsSync(obj) };
};

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

  if (course) {
    const courseExists = await Course.findById(course);
    if (!courseExists) {
      throw new ApiError(404, 'Course not found');
    }
  }

  if (!req.file) {
    throw new ApiError(400, 'File is required');
  }

  if (access_type === 'paid' && !(Number(price) > 0)) {
    throw new ApiError(400, 'A paid resource needs a price greater than zero');
  }

  // Generate a unique key. originalname is attacker-supplied and used to be
  // interpolated raw, which let `../` escape the uploads directory.
  const uniqueSuffix = crypto.randomBytes(8).toString('hex');
  const folder = course || 'standalone';
  const safeOriginal = sanitizeFileName(req.file.originalname);
  const key = `resources/${folder}/${resource_type}_${uniqueSuffix}_${safeOriginal}`;

  // Throws if the bytes are not genuinely persisted, so a failed upload can
  // never leave a database record pointing at a file that does not exist.
  const stored = await putFile(req.file.buffer, key, req.file.mimetype);

  const resource = await Resource.create({
    title,
    description,
    course: course || undefined,
    category: category || undefined,
    resource_type,
    access_type: access_type || 'free',
    price: price || 0,
    discount_price,
    file_url: stored.key,
    storage_provider: stored.provider,
    file_size: stored.size ?? req.file.size,
    mime_type: req.file.mimetype,
    original_name: safeOriginal,
    file_public_url: stored.url,
    created_by: req.user._id,
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        ...resource.toObject(),
        file_available: true,
        // Surfaced so the admin UI can warn that files stored on local disk
        // will not survive a redeploy.
        storage_is_durable: isDurable(),
      },
      'Resource uploaded successfully',
    ),
  );
});

// @desc    Delete a resource
// @route   DELETE /api/v1/resources/:id
// @access  Private/Admin
export const deleteResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);

  if (!resource) {
    throw new ApiError(404, 'Resource not found');
  }

  // Soft delete first so the record stops being downloadable even if removing
  // the stored file fails; a hard delete also destroyed the audit trail for
  // anything already purchased.
  resource.isDeleted = true;
  resource.deletedAt = new Date();
  resource.is_active = false;
  await resource.save();

  try {
    await removeFile(resource);
  } catch (error) {
    logger.error(
      `Resource ${resource._id} was soft-deleted but its file could not be removed: ${error.message}`,
    );
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Resource deleted successfully'));
});

// @desc    Get all resources
// @route   GET /api/v1/resources
// @access  Private/Student
export const getAllResources = asyncHandler(async (req, res) => {
  const filter = { isDeleted: false, is_active: true };

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
        resources.map(shapeResource),
        'Resources fetched successfully',
      ),
    );
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
        resources.map(shapeResource),
        'Resources fetched successfully',
      ),
    );
});

// @desc    Storage health (Admin)
// @route   GET /api/v1/resources/storage-status
// @access  Private/Admin
//
// Answers "are my uploads going to survive the next deploy, and how many files
// have already been lost" without needing shell access to the server.
export const getStorageStatus = asyncHandler(async (req, res) => {
  const resources = await Resource.find({ isDeleted: false }).select(
    'title file_url storage_provider access_type createdAt',
  );

  const missing = resources.filter((r) => !fileExistsSync(r));

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        provider: activeProvider(),
        durable: isDurable(),
        warning: isDurable()
          ? null
          : 'Files are stored on local disk and will be lost whenever the server is redeployed or restarted. Configure Cloudinary to store them durably.',
        total_resources: resources.length,
        missing_files: missing.length,
        missing: missing.slice(0, 50).map((r) => ({
          _id: r._id,
          title: r.title,
          file_url: r.file_url,
          access_type: r.access_type,
          uploaded_at: r.createdAt,
        })),
      },
      'Storage status fetched',
    ),
  );
});

// @desc    Download a resource
// @route   GET /api/v1/resources/:id/download
// @access  Private/Student (gated on access_type)
export const downloadResource = asyncHandler(async (req, res) => {
  if (!req.params.id || !/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
    logDownloadFailure(req, 'Invalid file ID');
    throw new ApiError(400, 'Invalid file ID');
  }

  const resource = await Resource.findById(req.params.id);

  if (!resource) {
    logDownloadFailure(req, 'Database record missing');
    throw new ApiError(404, 'Resource not found');
  }

  if (resource.isDeleted || !resource.is_active) {
    logDownloadFailure(req, 'Resource inactive');
    throw new ApiError(404, 'Resource not found');
  }

  if (!(await canAccessResource(resource, req.user))) {
    logDownloadFailure(req, 'Access denied', {
      accessType: resource.access_type,
    });
    throw new ApiError(
      403,
      'You do not have access to this resource. Please purchase it first.',
      [],
      '',
      'ACCESS_DENIED',
    );
  }

  if (!resource.file_url) {
    logDownloadFailure(req, 'Storage path missing');
    throw new ApiError(
      404,
      'This file is no longer available. Please contact support so it can be re-uploaded.',
      [],
      '',
      'FILE_MISSING',
    );
  }

  let opened;
  try {
    opened = await openReadStream(resource);
  } catch (error) {
    logDownloadFailure(req, 'Storage read failed', {
      storagePath: resource.file_url,
      errorMessage: error.message,
    });
    opened = null;
  }

  if (!opened) {
    // The record outlived its bytes. Record it so the admin storage report can
    // show exactly what needs re-uploading, and tell the student something
    // actionable instead of a bare "File not found".
    if (!resource.file_missing_since) {
      await Resource.updateOne(
        { _id: resource._id },
        { $set: { file_missing_since: new Date() } },
      );
    }

    logDownloadFailure(req, 'File missing from storage', {
      storagePath: resource.file_url,
      provider: resource.storage_provider,
    });

    throw new ApiError(
      404,
      'This file is no longer available on the server. Our team has been notified — please contact support if you need it urgently.',
      [],
      '',
      'FILE_MISSING',
    );
  }

  // The file is back (re-uploaded under the same key) — clear the flag.
  if (resource.file_missing_since) {
    await Resource.updateOne(
      { _id: resource._id },
      { $unset: { file_missing_since: 1 } },
    );
  }

  const ext = path.extname(resource.original_name || resource.file_url) || '';
  // Quoted filenames must not contain quotes, newlines or control characters —
  // setHeader throws ERR_INVALID_CHAR on those, which surfaced as a 500.
  const safeTitle =
    String(resource.title || 'resource')
      .replace(/[^A-Za-z0-9 ._-]/g, '_')
      .trim()
      .slice(0, 100) || 'resource';

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeTitle}${ext}"`,
  );
  res.setHeader(
    'Content-Type',
    resource.mime_type || 'application/octet-stream',
  );
  if (opened.size) res.setHeader('Content-Length', opened.size);

  const startTime = process.hrtime();
  const { stream } = opened;

  // pipe() does NOT forward source errors. An 'error' event with no listener
  // is an uncaught exception that kills the process — and because it fires
  // after this handler's promise has already resolved, asyncHandler cannot
  // catch it. Deleting a file mid-download was enough to take the server down.
  stream.on('error', (err) => {
    logDownloadFailure(req, 'Stream error', {
      storagePath: resource.file_url,
      errorMessage: err.message,
    });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to read the file',
        errors: [],
      });
    } else {
      res.destroy(err);
    }
  });

  // Client hung up — stop reading rather than leaking the descriptor.
  res.on('close', () => stream.destroy());

  res.on('finish', () => {
    const diff = process.hrtime(startTime);
    logger.info(
      JSON.stringify({
        event: 'DOWNLOAD_COMPLETE',
        correlationId: req.correlationId || 'none',
        userId: req.user._id,
        fileId: resource._id,
        fileName: resource.title,
        provider: resource.storage_provider,
        statusCode: res.statusCode,
        duration: (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2) + 'ms',
      }),
    );
  });

  stream.pipe(res);
});
