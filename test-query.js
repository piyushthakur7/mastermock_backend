import mongoose from 'mongoose';
import { MockTest } from './src/models/mockTest.model.js';
import { User } from './src/models/user.model.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    // Attempt to query using the exact select statement
    const filter = { isDeleted: false, is_active: true };
    const mockTests = await MockTest.find(filter)
      .select('-questions.options.is_correct')
      .limit(1);

    console.log('Query successful. Result length:', mockTests.length);
  } catch (err) {
    console.error('Error in query:', err.message);
  } finally {
    mongoose.disconnect();
  }
}

run();
