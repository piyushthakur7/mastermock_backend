import { AuditLog } from '../models/auditLog.model.js';

export const auditLogger = async (req, res, next) => {
  res.on('finish', async () => {
    // Log state changing requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      try {
        await AuditLog.create({
          actor: req.user ? req.user._id : null,
          action: `${req.method} ${req.originalUrl}`,
          module: 'API',
          ip_address: req.ip,
          metadata: {
            endpoint: req.originalUrl,
            method: req.method,
            user_agent: req.headers['user-agent'],
          },
        });
      } catch (err) {
        console.error('Audit log error:', err.message);
      }
    }
  });
  next();
};
