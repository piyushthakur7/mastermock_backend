import connectdb from './src/db/connection.js';
import { User } from './src/models/user.model.js';

const createAdmin = async () => {
  try {
    await connectdb();

    const adminEmail = 'admin@example.com';
    const password = 'Y8!vQ2#Lm7@Nx4$P!';

    let admin = await User.findOne({ email: adminEmail });
    if (admin) {
      console.log('Admin user already exists!');
      console.log(`Email: ${adminEmail}`);
      console.log(`Password: ${password}`);
      process.exit(0);
    }

    admin = await User.create({
      full_name: 'Test Admin',
      email: adminEmail,
      password_hash: password,
      phone_number: '0000000000',
      role: 'ADMIN',
      status: 'active',
    });

    console.log('Test admin user created successfully!');
    console.log(`Email: ${adminEmail}`);
    console.log(`Password: ${password}`);

    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  }
};

createAdmin();
