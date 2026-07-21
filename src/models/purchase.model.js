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
    item_id: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      refPath: 'item_type',
    },
    item_type: {
      type: String,
      required: true,
      enum: ['Course', 'Hack', 'Resource'],
    },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    amount: { type: Number },
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

// A user can hold at most ONE active purchase of a given item.
//
// grantAccess() has always caught error code 11000 here "in case another
// process created it concurrently" — but with no unique index that catch was
// unreachable and the surrounding findOne-then-create was a plain check-then-
// act race, so concurrent verify/webhook/poll paths could each insert a row.
// Partial (rather than plain) unique so a REFUNDED or EXPIRED purchase does
// not block the user from buying the same item again.
purchaseSchema.index(
  { user: 1, item_id: 1, item_type: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);

purchaseSchema.plugin(mongooseAggregatePaginate);
export const Purchase = mongoose.model('Purchase', purchaseSchema);
