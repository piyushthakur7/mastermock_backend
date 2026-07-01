import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const paymentSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    razorpay_order_id: { type: String, required: true, unique: true },
    razorpay_payment_id: { type: String },
    razorpay_signature: { type: String },
    item_id: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: 'item_type',
    },
    item_type: {
      type: String,
      required: true,
      enum: ['Course', 'MockTest'],
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'],
      default: 'PENDING',
      index: true,
    },
  },
  { timestamps: true },
);

paymentSchema.plugin(mongooseAggregatePaginate);

// Compound index for idempotency checks during order creation
paymentSchema.index({ user: 1, item_id: 1, status: 1 });

export const Payment = mongoose.model('Payment', paymentSchema);
