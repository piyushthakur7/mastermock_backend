import mongoose, { Schema } from 'mongoose';

const categorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      // `unique` builds the index on its own; the extra `index: true` only
      // produced a duplicate-index warning at boot.
      unique: true,
      trim: true,
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
