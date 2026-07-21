import mongoose, { Schema } from 'mongoose';

const replySchema = new Schema(
  {
    message: { type: String, required: true, trim: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    author_role: {
      type: String,
      enum: ['STUDENT', 'ADMIN'],
      required: true,
    },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const inquirySchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      default: 'OPEN',
    },

    // The conversation. The model previously held a single `admin_reply`
    // string, so a second reply overwrote the first and the student could
    // never respond at all.
    replies: [replySchema],

    // Deprecated single-reply fields, kept so rows written before threading
    // existed still render. Nothing writes these any more — the `thread`
    // virtual folds them into the reply list.
    admin_reply: { type: String },
    replied_by: { type: Schema.Types.ObjectId, ref: 'User' },
    replied_at: { type: Date },
  },
  { timestamps: true },
);

inquirySchema.index({ student: 1, createdAt: -1 });
inquirySchema.index({ status: 1, createdAt: -1 });

// Single chronological view over both the new thread and any legacy reply.
inquirySchema.virtual('thread').get(function buildThread() {
  const thread = (this.replies || []).map((r) => ({
    _id: r._id,
    message: r.message,
    author: r.author,
    author_role: r.author_role,
    created_at: r.created_at,
  }));

  if (this.admin_reply) {
    thread.push({
      _id: `${this._id}-legacy`,
      message: this.admin_reply,
      author: this.replied_by || null,
      author_role: 'ADMIN',
      created_at: this.replied_at || this.updatedAt || this.createdAt,
    });
  }

  return thread.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
});

inquirySchema.set('toJSON', { virtuals: true });
inquirySchema.set('toObject', { virtuals: true });

export const Inquiry = mongoose.model('Inquiry', inquirySchema);
