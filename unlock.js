import connectdb from './src/db/index.js';
import { User } from './src/models/user.model.js';

connectdb()
  .then(async () => {
    await User.updateMany(
      { email: 'admin@example.com' },
      { $set: { loginAttempts: 0, lockUntil: null } }
    );
    console.log('Admin account unlocked successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
