import path from 'node:path';
import swaggerJSDoc from 'swagger-jsdoc';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'APK Modder API',
      version: '1.0.0',
      description: 'API for APK upload, parse, modify and build pipeline.'
    },
    servers: [{ url: 'http://localhost:3000' }]
  },
  apis: [path.resolve(__dirname, '../routes/*.ts')]
});
