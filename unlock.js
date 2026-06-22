import { connectDB } from './src/db/index.js';
import { User } from './src/models/user.model.js';

async function unlockAdmin() {
  try {
    await connectDB();
    const user = await User.findOneAndUpdate(
      { email: 'admin@example.com' },
      { $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } },
      { new: true }
    );
    console.log('Unlocked user:', user ? user.email : 'Not found');
  } catch (error) {
    console.error('Error unlocking user:', error);
  } process.exit(0);
}

unlockAdmin();
