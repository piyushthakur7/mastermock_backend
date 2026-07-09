import mongoose from 'mongoose';
import { env } from './src/config/env.js';

const migrateDb = async () => {
  try {
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected to MongoDB for migration');

    const db = mongoose.connection.db;

    // 1. Rename collection 'mocktests' to 'hacks'
    const collections = await db.listCollections().toArray();
    const hasMockTests = collections.some((c) => c.name === 'mocktests');
    const hasHacks = collections.some((c) => c.name === 'hacks');

    if (hasMockTests && !hasHacks) {
      await db.collection('mocktests').rename('hacks');
      console.log('Renamed collection mocktests -> hacks');
    } else {
      console.log(
        'Collection rename skipped (mocktests not found or hacks already exists)',
      );
    }

    // 2. Update item_type 'MockTest' -> 'Hack' in purchases
    const purchaseResult = await db
      .collection('purchases')
      .updateMany({ item_type: 'MockTest' }, { $set: { item_type: 'Hack' } });
    console.log(
      `Updated ${purchaseResult.modifiedCount} purchases from MockTest -> Hack`,
    );

    // 3. Update item_type 'MockTest' -> 'Hack' in payments
    const paymentResult = await db
      .collection('payments')
      .updateMany({ item_type: 'MockTest' }, { $set: { item_type: 'Hack' } });
    console.log(
      `Updated ${paymentResult.modifiedCount} payments from MockTest -> Hack`,
    );

    // 4. Update 'mock_test' field to 'hack' in testattempts
    const attemptResult = await db
      .collection('testattempts')
      .updateMany(
        { mock_test: { $exists: true } },
        { $rename: { mock_test: 'hack' } },
      );
    console.log(`Updated testattempts (mock_test -> hack)`);

    console.log('Migration complete.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrateDb();
