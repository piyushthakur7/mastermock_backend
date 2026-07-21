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
      enum: ['Course', 'Hack', 'Resource'],
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'],
      default: 'PENDING',
      index: true,
    },

    // Set once Purchase (and, for a Course, Enrollment) provisioning has
    // completed. A SUCCESS payment with this still unset means "money taken,
    // access not yet granted" — previously an unrecoverable state, because
    // both verifyPayment and getPaymentStatus short-circuited on SUCCESS and
    // never re-ran provisioning. Every read path now repairs it.
    access_granted_at: { type: Date },

    // Refund bookkeeping. The REFUNDED enum value existed but nothing in the
    // codebase could ever set it.
    razorpay_refund_id: { type: String },
    refund_amount: { type: Number },
    refunded_at: { type: Date },
    refund_reason: { type: String },

    failure_reason: { type: String },
  },
  { timestamps: true },
);

paymentSchema.plugin(mongooseAggregatePaginate);

// Compound index for idempotency checks during order creation
paymentSchema.index({ user: 1, item_id: 1, status: 1 });

// At most one open order per user+item. Without this, a second "Buy" click
// after the 5-minute idempotency window minted a second Razorpay order for the
// same item — and a user who paid both was charged twice with no refund path.
paymentSchema.index(
  { user: 1, item_id: 1, item_type: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);

// Finds SUCCESS payments whose provisioning never completed, for the repair
// sweep and for support tooling.
paymentSchema.index({ status: 1, access_granted_at: 1 });

export const Payment = mongoose.model('Payment', paymentSchema);
