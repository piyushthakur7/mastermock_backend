import mongoose, { Schema } from 'mongoose';
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate-v2';

const auditLogSchema = new Schema(
  {
    // Nullable: unauthenticated state-changing requests (login, register,
    // password reset) have no actor. Requiring it made every such request
    // throw "AuditLog validation failed: actor is required".
    actor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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
