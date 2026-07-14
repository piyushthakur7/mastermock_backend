import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables manually
dotenv.config();

// We can import the existing model and DB connection
import connectdb from './src/db/index.js';
import { Resource } from './src/models/resource.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cleanMissingResources = async () => {
  try {
    await connectdb();
    console.log('Connected to database. Checking for missing resources...');

    const resources = await Resource.find({});
    console.log(`Found ${resources.length} total resources in the database.`);

    let deletedCount = 0;

    for (const resource of resources) {
      if (!resource.file_url) {
        // Corrupted record, no file URL
        await Resource.deleteOne({ _id: resource._id });
        console.log(`Deleted resource "${resource.title}" (No file_url)`);
        deletedCount++;
        continue;
      }

      const fullPath = path.join(__dirname, 'uploads', resource.file_url);

      if (!fs.existsSync(fullPath)) {
        await Resource.deleteOne({ _id: resource._id });
        console.log(
          `Deleted resource "${resource.title}" (File missing on disk: ${resource.file_url})`,
        );
        deletedCount++;
      }
    }

    console.log(
      `\nCleanup complete! Deleted ${deletedCount} invalid resource records.`,
    );
    process.exit(0);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
};

cleanMissingResources();
