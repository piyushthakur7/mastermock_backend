import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const resourceSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String },
    course: {
      type: Schema.Types.ObjectId,
      ref: 'Course',
      index: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      index: true,
    },
    file_url: { type: String, required: true },
    resource_type: {
      type: String,
      enum: ['pdf', 'video', 'notes', 'assignment', 'solution'],
      required: true,
    },
    access_type: {
      type: String,
      enum: ['free', 'paid'],
      default: 'free',
      index: true,
    },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    is_active: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

resourceSchema.plugin(mongooseAggregatePaginate);
export const Resource = mongoose.model('Resource', resourceSchema);
