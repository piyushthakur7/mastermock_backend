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
      enum: ['Course', 'MockTest'],
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

purchaseSchema.plugin(mongooseAggregatePaginate);
export const Purchase = mongoose.model('Purchase', purchaseSchema);
