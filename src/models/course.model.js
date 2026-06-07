import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const courseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, default: 0 },
    access_type: { type: String, enum: ['free', 'paid'], default: 'paid' },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      index: true,
      required: true,
    },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    is_active: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

courseSchema.plugin(mongooseAggregatePaginate);
export const Course = mongoose.model('Course', courseSchema);
