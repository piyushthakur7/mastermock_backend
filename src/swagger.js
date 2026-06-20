import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Mastermock API Documentation',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'https://backend.mastermocks.in/api/v1',
        description: 'Production Server',
      },
      {
        url: 'http://localhost:5000/api/v1',
        description: 'Local Server',
      },
    ],
  },
  apis: [path.join(__dirname, './routes/*.js')],
};

const specs = swaggerJsdoc(options);

export const setupSwagger = async (app) => {
  if (process.env.VERCEL) {
    console.warn(
      'Swagger UI disabled on Vercel to prevent crashes due to missing static assets.',
    );
    return;
  }

  try {
    const swaggerUi = (await import('swagger-ui-express')).default;
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
  } catch (error) {
    console.warn('Failed to setup Swagger:', error.message);
  }
};
