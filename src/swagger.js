import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Mastermock API Documentation',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'http://localhost:5000/api/v1',
      },
    ],
  },
  apis: ['./src/routes/*.js'],
};

const specs = swaggerJsdoc(options);

export const setupSwagger = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
};
