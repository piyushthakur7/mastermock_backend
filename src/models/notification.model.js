import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const notificationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ['SYSTEM', 'PURCHASE', 'COURSE_UPDATE', 'TEST_RESULT'],
      default: 'SYSTEM',
    },
    is_read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// TTL Index: Auto-delete notifications older than 30 days (2592000 seconds)
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

notificationSchema.plugin(mongooseAggregatePaginate);
export const Notification = mongoose.model('Notification', notificationSchema);
