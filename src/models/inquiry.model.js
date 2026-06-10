import mongoose, { Schema } from 'mongoose';

const inquirySchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      default: 'OPEN',
    },
    admin_reply: { type: String },
    replied_by: { type: Schema.Types.ObjectId, ref: 'User' },
    replied_at: { type: Date },
  },
  { timestamps: true },
);

export const Inquiry = mongoose.model('Inquiry', inquirySchema);
