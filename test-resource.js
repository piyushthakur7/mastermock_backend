import { connectDB } from './src/config/db.js';
import { Resource } from './src/models/resource.model.js';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  await connectDB();
  const resource = await Resource.findOne();
  console.log('Resource:', JSON.stringify(resource, null, 2));
  process.exit(0);
}

test().catch(console.error);
