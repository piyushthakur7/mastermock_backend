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
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
      index: true,
    },
  },
  { timestamps: true },
);

paymentSchema.plugin(mongooseAggregatePaginate);
export const Payment = mongoose.model('Payment', paymentSchema);
