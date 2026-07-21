import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const optionSchema = new Schema({
  text: { type: String, required: true },
  is_correct: { type: Boolean, required: true },
});

const questionSchema = new Schema({
  text: { type: String, required: true },
  marks: { type: Number, default: 1 },
  explanation: { type: String },
  options: [optionSchema],
});

const hackSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    description: { type: String },
    course: { type: Schema.Types.ObjectId, ref: 'Course', index: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', index: true },

    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    },
    access_type: {
      type: String,
      enum: ['free', 'paid'],
      default: 'free',
      index: true,
    },
    price: { type: Number, default: 0 },
    // Derived from `questions` on every save — never trusted from the client.
    // See the pre-save hook below.
    total_questions: { type: Number, default: 0 },
    passing_marks: { type: Number, required: true },
    negative_marking: { type: Boolean, default: false },
    negative_marks_per_wrong: { type: Number, default: 0 },
    total_marks: { type: Number, default: 0 },
    duration_minutes: { type: Number, required: true },
    start_time: { type: Date },
    end_time: { type: Date },

    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    is_active: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },

    questions: [questionSchema],
  },
  { timestamps: true },
);

// total_marks and total_questions used to be free-form numbers typed by the
// admin at creation time and never reconciled afterwards: adding questions did
// not update them. Scoring divides by total_marks, so a hack created with
// total_marks=100 and later filled with 20 one-mark questions reported a
// perfect paper as 20%. Derive both from the questions themselves.
hackSchema.pre('save', function recomputeTotals() {
  if (Array.isArray(this.questions)) {
    this.total_questions = this.questions.length;
    this.total_marks = this.questions.reduce(
      (sum, q) => sum + (Number(q.marks) || 0),
      0,
    );
  }
});

hackSchema.plugin(mongooseAggregatePaginate);
export const Hack = mongoose.model('Hack', hackSchema);
