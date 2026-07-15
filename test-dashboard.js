import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { User } from './src/models/user.model.js';
import { Course } from './src/models/course.model.js';
import { Hack } from './src/models/hack.model.js';
import { Payment } from './src/models/payment.model.js';

async function test() {
  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log('Connected to MongoDB');

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

    console.log({
      totalStudents,
      totalCourses,
      totalTests,
      totalFreeTests,
      totalPaidTests,
      revenue,
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

test();
