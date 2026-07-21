import { reconcileStalePayments } from '../services/payment.service.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Periodically settle payments that no browser is going to settle.
 *
 * Reconciliation used to depend entirely on the customer's tab staying open:
 * the client verify call, or a status poll fired when the Razorpay modal was
 * dismissed. Close the tab between paying and either of those and the Payment
 * row stayed PENDING forever, with no server-side path to resolve it.
 *
 * The webhook is the primary fix; this is the backstop for when a webhook is
 * missed, mis-delivered, or not configured yet. It also repairs SUCCESS
 * payments whose access provisioning failed halfway.
 */
export const setupPaymentReconciler = () => {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    console.warn(
      'Serverless environment detected. Payment reconciler disabled; rely on the Razorpay webhook and POST /api/v1/payments/reconcile.',
    );
    return;
  }

  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    console.warn('Razorpay is not configured. Payment reconciler not started.');
    return;
  }

  const run = async () => {
    try {
      await reconcileStalePayments();
    } catch (err) {
      logger.error(`Payment reconciliation sweep failed: ${err.message}`);
    }
  };

  const timer = setInterval(run, RECONCILE_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info('Payment reconciler started');
  return timer;
};
