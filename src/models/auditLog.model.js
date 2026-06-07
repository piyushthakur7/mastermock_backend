import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const auditLogSchema = new Schema(
  {
    actor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: { type: String, required: true, index: true }, // e.g. "DELETE_COURSE", "LOGIN"
    module: { type: String, required: true }, // e.g. "COURSE", "USER"
    target_id: { type: Schema.Types.ObjectId },
    metadata: { type: Schema.Types.Mixed },
    ip_address: { type: String },
    user_agent: { type: String },
  },
  { timestamps: true },
);

auditLogSchema.plugin(mongooseAggregatePaginate);
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
