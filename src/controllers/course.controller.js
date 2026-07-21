import { Course } from '../models/course.model.js';
import { Enrollment } from '../models/enrollment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// @desc    Create a new course
// @route   POST /api/v1/courses
// @access  Private/Admin
export const createCourse = asyncHandler(async (req, res) => {
  const { title, description, price, access_type, category } = req.body;

  const course = await Course.create({
    title,
    description,
    price,
    access_type,
    category,
    created_by: req.user._id,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, course, 'Course created successfully'));
});

// @desc    Update a course
// @route   PUT /api/v1/courses/:id
// @access  Private/Admin
export const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: req.body },
    { new: true, runValidators: true },
  );

  if (!course) {
    throw new ApiError(404, 'Course not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, course, 'Course updated successfully'));
});

// @desc    Delete a course (Soft Delete)
// @route   DELETE /api/v1/courses/:id
// @access  Private/Admin
export const deleteCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date() } },
    { new: true },
  );

  if (!course) {
    throw new ApiError(404, 'Course not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Course deleted successfully'));
});

// @desc    Publish a course
// @route   PATCH /api/v1/courses/:id/publish
// @access  Private/Admin
export const publishCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { is_active: true } },
    { new: true },
  );

  if (!course) {
    throw new ApiError(404, 'Course not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, course, 'Course published successfully'));
});

// @desc    Unpublish a course
// @route   PATCH /api/v1/courses/:id/unpublish
// @access  Private/Admin
export const unpublishCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { is_active: false } },
    { new: true },
  );

  if (!course) {
    throw new ApiError(404, 'Course not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, course, 'Course unpublished successfully'));
});

// @desc    Get all courses (Public/Student)
// @route   GET /api/v1/courses
// @access  Public
export const getCourses = asyncHandler(async (req, res) => {
  const filter = { isDeleted: false };

  // If not admin, only show active courses
  if (req.user.role !== 'ADMIN') {
    filter.is_active = true;
  }

  const courses = await Course.find(filter)
    .populate('category', 'name')
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, courses, 'Courses fetched successfully'));
});

// @desc    Get a single course
// @route   GET /api/v1/courses/:id
// @access  Public
export const getCourseById = asyncHandler(async (req, res) => {
  const filter = { _id: req.params.id, isDeleted: false };

  if (req.user.role !== 'ADMIN') {
    filter.is_active = true;
  }

  const course = await Course.findOne(filter).populate('category', 'name');

  if (!course) {
    throw new ApiError(404, 'Course not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, course, 'Course fetched successfully'));
});

// @desc    Enroll in a course
// @route   POST /api/v1/courses/:id/enroll
// @access  Private/Student
export const enrollCourse = asyncHandler(async (req, res) => {
  const course = await Course.findOne({
    _id: req.params.id,
    isDeleted: false,
    is_active: true,
  });

  if (!course) {
    throw new ApiError(404, 'Course not found or inactive');
  }

  if (course.access_type === 'paid') {
    throw new ApiError(400, 'Paid courses require purchase to enroll');
  }

  const existingEnrollment = await Enrollment.findOne({
    user: req.user._id,
    course: course._id,
  });
  if (existingEnrollment) {
    throw new ApiError(400, 'You are already enrolled in this course');
  }

  const enrollment = await Enrollment.create({
    user: req.user._id,
    course: course._id,
    status: 'ACTIVE',
  });

  return res
    .status(201)
    .json(new ApiResponse(201, enrollment, 'Successfully enrolled in course'));
});

// @desc    Get my enrolled courses
// @route   GET /api/v1/courses/my/enrolled
// @access  Private/Student
export const getMyCourses = asyncHandler(async (req, res) => {
  const enrollments = await Enrollment.find({
    user: req.user._id,
    status: 'ACTIVE',
  })
    .populate({
      path: 'course',
      match: { isDeleted: false },
      populate: {
        path: 'category',
        select: 'name',
      },
    })
    .sort({ createdAt: -1 });

  const myCourses = enrollments
    .filter((e) => e.course !== null)
    .map((e) => e.course);

  return res
    .status(200)
    .json(
      new ApiResponse(200, myCourses, 'Enrolled courses fetched successfully'),
    );
});
