import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const answerSnapshotSchema = new Schema(
  {
    question_id: { type: Schema.Types.ObjectId, required: true },
    question_text: { type: String, required: true },
    selected_option_id: { type: Schema.Types.ObjectId },
    selected_option_text: { type: String },
    is_correct: { type: Boolean, default: false },
    // What this answer actually contributed, negative marking included. Makes
    // a result explainable without re-deriving it from the live answer key.
    marks_awarded: { type: Number, default: 0 },
    is_marked_for_review: { type: Boolean, default: false },
    answered_at: { type: Date },
  },
  { _id: false },
);

const testAttemptSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    hack: {
      type: Schema.Types.ObjectId,
      ref: 'Hack',
      required: true,
      index: true,
    },
    started_at: { type: Date, default: Date.now },
    // Hard deadline for the attempt; the auto-submit sweeper completes any
    // IN_PROGRESS attempt past this time.
    expires_at: { type: Date, index: true },
    completed_at: { type: Date },
    status: {
      type: String,
      enum: ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'],
      default: 'IN_PROGRESS',
    },

    answers: [answerSnapshotSchema],

    score: { type: Number, default: 0 },
    // Denominator snapshotted at scoring time, derived from the questions that
    // actually existed. Reading hack.total_marks at display time meant an
    // admin editing the test silently re-based every historical percentage.
    total_marks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    scored_at: { type: Date },
    rank: { type: Number },
    feedback: { type: String },
  },
  { timestamps: true },
);

// For instantly fetching a user's history for a specific test. Includes
// `status` so the key pattern stays distinct from the partial unique index
// below (Mongoose warns on two indexes sharing a key pattern).
testAttemptSchema.index({ user: 1, hack: 1, status: 1 });
// At most one live attempt per user per test. Without this, double-clicking
// "Start Test" raced the findOne-then-create in startTest and produced two
// concurrent IN_PROGRESS attempts for the same student.
testAttemptSchema.index(
  { user: 1, hack: 1 },
  { unique: true, partialFilterExpression: { status: 'IN_PROGRESS' } },
);
// For instantly generating Leaderboards
testAttemptSchema.index({ hack: 1, score: -1, completed_at: 1 });

testAttemptSchema.plugin(mongooseAggregatePaginate);
export const TestAttempt = mongoose.model('TestAttempt', testAttemptSchema);
