import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const enrollmentSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    course: {
      type: Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'REVOKED'],
      default: 'ACTIVE',
    },
    enrolled_at: { type: Date, default: Date.now },
    access_expires_at: { type: Date },
  },
  { timestamps: true },
);

// A user should only be enrolled in a specific course once
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });
enrollmentSchema.plugin(mongooseAggregatePaginate);
export const Enrollment = mongoose.model('Enrollment', enrollmentSchema);
