import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const connectdb = async () => {
    try {
        const connectionInstance = await mongoose.connect(`${env.MONGO_URI}/${DB_NAME}`);
        logger.info(`MongoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
    } catch (error) {
        logger.error("MongoDB connection failed: ", error);
        process.exit(1);
    }
};

export default connectdb;
