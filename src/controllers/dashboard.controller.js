import { Course } from '../models/course.model.js';
import { Hack } from '../models/hack.model.js';
import { TestAttempt } from '../models/testAttempt.model.js';
import { User } from '../models/user.model.js';
import { Payment } from '../models/payment.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getStudentDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Aggregate rather than pulling every completed attempt into Node. Each
  // attempt document carries its full answers snapshot, so loading them all to
  // compute one average and take five was expensive and grew without bound.
  const [stats] = await TestAttempt.aggregate([
    { $match: { user: userId, status: 'COMPLETED' } },
    {
      $group: {
        _id: null,
        totalAttempts: { $sum: 1 },
        avgScore: { $avg: '$score' },
        avgPercentage: { $avg: '$percentage' },
        bestScore: { $max: '$score' },
      },
    },
  ]);

  const recent = await TestAttempt.find({ user: userId, status: 'COMPLETED' })
    .sort({ completed_at: -1 })
    .limit(5)
    .select('hack completed_at started_at score percentage')
    .populate('hack', 'title');

  const recentActivity = recent.map((attempt) => ({
    type: 'TEST_ATTEMPT',
    title: `Attempted: ${attempt.hack?.title || 'Unknown Test'}`,
    date: attempt.completed_at || attempt.started_at,
    score: attempt.score,
    percentage: attempt.percentage,
  }));

  res.json(
    new ApiResponse(
      200,
      {
        totalAttempts: stats?.totalAttempts || 0,
        avgScore: (stats?.avgScore || 0).toFixed(2),
        avgPercentage: (stats?.avgPercentage || 0).toFixed(2),
        bestScore: stats?.bestScore || 0,
        recentActivity,
      },
      'Student dashboard fetched',
    ),
  );
});

export const getAdminDashboard = asyncHandler(async (req, res) => {
  const [
    totalStudents,
    totalCourses,
    totalTests,
    totalFreeTests,
    totalPaidTests,
    revenueRows,
  ] = await Promise.all([
    User.countDocuments({ role: 'STUDENT' }),
    Course.countDocuments({ isDeleted: false }),
    Hack.countDocuments({ isDeleted: false }),
    Hack.countDocuments({ isDeleted: false, access_type: 'free' }),
    Hack.countDocuments({ isDeleted: false, access_type: 'paid' }),
    // Summing in the database instead of loading every SUCCESS payment ever
    // made into memory.
    Payment.aggregate([
      {
        $group: {
          _id: '$status',
          amount: { $sum: '$amount' },
          refunded: { $sum: { $ifNull: ['$refund_amount', 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const byStatus = Object.fromEntries(revenueRows.map((row) => [row._id, row]));

  const grossRevenue = byStatus.SUCCESS?.amount || 0;
  // Refunds can be partial, so they are tracked as an amount rather than
  // inferred from the status alone.
  const refundedAmount = revenueRows.reduce(
    (sum, row) => sum + (row.refunded || 0),
    0,
  );

  res.json(
    new ApiResponse(
      200,
      {
        totalStudents,
        totalCourses,
        totalTests,
        totalFreeTests,
        totalPaidTests,
        revenue: grossRevenue - refundedAmount,
        grossRevenue,
        refundedAmount,
        successfulPayments: byStatus.SUCCESS?.count || 0,
        pendingPayments: byStatus.PENDING?.count || 0,
        failedPayments: byStatus.FAILED?.count || 0,
        refundedPayments: byStatus.REFUNDED?.count || 0,
      },
      'Admin dashboard fetched',
    ),
  );
});
