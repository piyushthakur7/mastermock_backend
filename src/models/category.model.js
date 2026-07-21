import mongoose, { Schema } from 'mongoose';

const categorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
    },
    parentCategory: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const Category = mongoose.model('Category', categorySchema);
