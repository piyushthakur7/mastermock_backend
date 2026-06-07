import { env } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import app from './src/app.js';
import connectdb from './src/db/INDEX.JS';

const PORT = env.PORT;

connectdb()
.then(() => {
    app.listen(PORT, () => {
        logger.info(`Server running at http://localhost:${PORT}/`);
    });
})
.catch((err) => {
    logger.error("MongoDB connection failed !!! ", err);
});
