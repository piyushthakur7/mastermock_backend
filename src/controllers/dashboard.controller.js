import { Course } from '../models/course.model.js';
import { Hack } from '../models/hack.model.js';
import { TestAttempt } from '../models/testAttempt.model.js';
import { User } from '../models/user.model.js';
import { Payment } from '../models/payment.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getStudentDashboard = asyncHandler(async (req, res) => {
  const totalAttempts = await TestAttempt.countDocuments({
    user: req.user._id,
    status: 'COMPLETED',
  });
  const attempts = await TestAttempt.find({
    user: req.user._id,
    status: 'COMPLETED',
  })
    .sort({ completed_at: -1 })
    .populate('hack', 'title');

  const avgScore =
    attempts.length > 0
      ? attempts.reduce((acc, curr) => acc + curr.score, 0) / attempts.length
      : 0;

  const recentActivity = attempts.slice(0, 5).map((attempt) => ({
    type: 'TEST_ATTEMPT',
    title: `Attempted: ${attempt.hack?.title || 'Unknown Test'}`,
    date: attempt.completed_at || attempt.started_at,
  }));

  res.json(
    new ApiResponse(
      200,
      {
        totalAttempts,
        avgScore: avgScore.toFixed(2),
        recentActivity,
      },
      'Student dashboard fetched',
    ),
  );
});

export const getAdminDashboard = asyncHandler(async (req, res) => {
  const totalStudents = await User.countDocuments({ role: 'STUDENT' });
  const totalCourses = await Course.countDocuments({ isDeleted: false });
  const totalTests = await Hack.countDocuments({ isDeleted: false });
  const totalFreeTests = await Hack.countDocuments({
    isDeleted: false,
    access_type: 'free',
  });
  const totalPaidTests = await Hack.countDocuments({
    isDeleted: false,
    access_type: 'paid',
  });

  const payments = await Payment.find({ status: 'SUCCESS' });
  const revenue = payments.reduce((acc, curr) => acc + curr.amount, 0);

  res.json(
    new ApiResponse(
      200,
      {
        totalStudents,
        totalCourses,
        totalTests,
        totalFreeTests,
        totalPaidTests,
        revenue,
      },
      'Admin dashboard fetched',
    ),
  );
});
