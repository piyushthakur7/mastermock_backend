import mongoose from 'mongoose';
import { User } from './src/models/user.model.js';
import connectdb from './src/db/connection.js';

async function run() {
  try {
    await connectdb();
    console.log('Connected to DB');
    const res = await User.deleteMany({ full_name: 'Piyush Randi' });
    console.log('Deleted', res.deletedCount, 'users');
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.connection.close();
  }
}

run();
