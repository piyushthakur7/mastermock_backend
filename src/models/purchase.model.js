import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const purchaseSchema = new Schema(
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
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    purchase_date: { type: Date, default: Date.now },
    access_expires_at: { type: Date },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'REFUNDED'],
      default: 'ACTIVE',
    },
  },
  { timestamps: true },
);

purchaseSchema.plugin(mongooseAggregatePaginate);
export const Purchase = mongoose.model('Purchase', purchaseSchema);
