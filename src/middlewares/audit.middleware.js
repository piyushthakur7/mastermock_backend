import { AuditLog } from '../models/auditLog.model.js';

export const auditLogger = async (req, res, next) => {
  res.on('finish', async () => {
    // Log state changing requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      try {
        await AuditLog.create({
          user: req.user ? req.user._id : null,
          action: `${req.method} ${req.originalUrl}`,
          ip_address: req.ip,
          endpoint: req.originalUrl,
          method: req.method,
        });
      } catch (err) {
        console.error('Audit log error:', err.message);
      }
    }
  });
  next();
};
