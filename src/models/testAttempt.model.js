import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const answerSnapshotSchema = new Schema(
  {
    question_id: { type: Schema.Types.ObjectId, required: true },
    question_text: { type: String, required: true },
    selected_option_id: { type: Schema.Types.ObjectId },
    selected_option_text: { type: String },
    is_correct: { type: Boolean, default: false },
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
    mock_test: {
      type: Schema.Types.ObjectId,
      ref: 'MockTest',
      required: true,
      index: true,
    },
    started_at: { type: Date, default: Date.now },
    completed_at: { type: Date },
    status: {
      type: String,
      enum: ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'],
      default: 'IN_PROGRESS',
    },

    answers: [answerSnapshotSchema],

    score: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    rank: { type: Number },
    feedback: { type: String },
  },
  { timestamps: true },
);

// For instantly fetching a user's history for a specific test
testAttemptSchema.index({ user: 1, mock_test: 1 });
// For instantly generating Leaderboards
testAttemptSchema.index({ mock_test: 1, score: -1, completed_at: 1 });

testAttemptSchema.plugin(mongooseAggregatePaginate);
export const TestAttempt = mongoose.model('TestAttempt', testAttemptSchema);
