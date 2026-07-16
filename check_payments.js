require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection;
  const payments = await db.collection('payments').find({}).toArray();
  const purchases = await db.collection('purchases').find({}).toArray();
  console.log('PAYMENTS:', JSON.stringify(payments, null, 2));
  console.log('PURCHASES:', JSON.stringify(purchases, null, 2));
  process.exit(0);
}
run();
