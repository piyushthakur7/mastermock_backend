import mongoose from 'mongoose';
import { DB_NAME } from '../constants.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const connectdb = async () => {
  if (mongoose.connection.readyState >= 1) {
    logger.info('MongoDB already connected');
    return;
  }
  try {
    // Do NOT concatenate the database name onto the URI. The standard Atlas
    // string ends in `/?retryWrites=true&w=majority`, so appending `/mastermock`
    // pushed the database name into the query string and silently connected to
    // `test` instead — with no error and no log line to show for it. The
    // driver's dbName option is authoritative regardless of URI shape.
    const connectionInstance = await mongoose.connect(env.MONGO_URI, {
      dbName: DB_NAME,
    });
    logger.info(
      `MongoDB connected !! DB HOST: ${connectionInstance.connection.host} DB: ${connectionInstance.connection.name}`,
    );
  } catch (error) {
    logger.error('MongoDB connection failed: ', error);
    process.exit(1);
  }
};

export default connectdb;
