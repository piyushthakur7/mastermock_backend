import { Category } from '../models/category.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// @desc    Create a new category
// @route   POST /api/v1/categories
// @access  Private/Admin
export const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;

  const categoryExists = await Category.findOne({ name });
  if (categoryExists) {
    throw new ApiError(400, 'Category already exists');
  }

  const category = await Category.create({
    name,
    description,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, category, 'Category created successfully'));
});

// @desc    Update a category
// @route   PUT /api/v1/categories/:id
// @access  Private/Admin
export const updateCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const { id } = req.params;

  const category = await Category.findById(id);

  if (!category) {
    throw new ApiError(404, 'Category not found');
  }

  if (name && name !== category.name) {
    const categoryExists = await Category.findOne({ name });
    if (categoryExists) {
      throw new ApiError(400, 'Category with this name already exists');
    }
    category.name = name;
  }

  if (description !== undefined) {
    category.description = description;
  }

  await category.save();

  return res
    .status(200)
    .json(new ApiResponse(200, category, 'Category updated successfully'));
});

// @desc    Delete a category
// @route   DELETE /api/v1/categories/:id
// @access  Private/Admin
export const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const category = await Category.findById(id);

  if (!category) {
    throw new ApiError(404, 'Category not found');
  }

  await category.deleteOne();

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Category deleted successfully'));
});

// @desc    Get all categories
// @route   GET /api/v1/categories
// @access  Public
export const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({}).sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, categories, 'Categories fetched successfully'));
});

// @desc    Get a category by ID
// @route   GET /api/v1/categories/:id
// @access  Public
export const getCategoryById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const category = await Category.findById(id);

  if (!category) {
    throw new ApiError(404, 'Category not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, category, 'Category fetched successfully'));
});
