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
    // Storage key. For local storage this is a path relative to uploads/; for
    // a cloud provider it is that provider's object id. Never an absolute URL
    // the client could fetch directly — downloads must go through the API so
    // the paid-resource access check cannot be bypassed.
    file_url: { type: String, required: true },
    storage_provider: {
      type: String,
      enum: ['local', 'cloudinary'],
      default: 'local',
      index: true,
    },
    // Recorded at upload so downloads can send the right Content-Type and
    // Content-Length instead of guessing from the file extension.
    file_size: { type: Number },
    mime_type: { type: String },
    original_name: { type: String },
    // Cloud providers hand back a canonical URL; kept for server-side fetches.
    file_public_url: { type: String },
    // Set when a download finds the bytes gone. Local uploads do not survive a
    // redeploy on a host that rebuilds the filesystem, and the record used to
    // keep advertising a file that no longer existed.
    file_missing_since: { type: Date },
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
    price: { type: Number, default: 0 },
    discount_price: { type: Number },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    is_active: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

resourceSchema.plugin(mongooseAggregatePaginate);
export const Resource = mongoose.model('Resource', resourceSchema);
