import 'dotenv/config';
import { createServer, setupWebSocket } from './server.js';
import { testConnection as testDbConnection, closePool } from './database/client.js';
import { testRedisConnection, closeRedis } from './services/RedisService.js';
import { logger } from './utils/logger.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  logger.info('Starting Claude Dev Automation API...');

  // Test database connection
  const dbConnected = await testDbConnection();
  if (!dbConnected) {
    logger.warn('Database connection failed - some features may be unavailable');
  }

  // Test Redis connection
  const redisConnected = await testRedisConnection();
  if (!redisConnected) {
    logger.warn('Redis connection failed - some features may be unavailable');
  }

  // Create Fastify server
  const server = await createServer();

  // Setup WebSocket
  const io = setupWebSocket(server.server);

  // Store io instance for use in routes/services
  server.decorate('io', io);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    try {
      await server.close();
      logger.info('HTTP server closed');

      io.close();
      logger.info('WebSocket server closed');

      await closePool();
      await closeRedis();

      logger.info('Cleanup complete, exiting');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  try {
    await server.listen({ port: PORT, host: HOST });
    logger.info({ port: PORT, host: HOST }, 'Server is running');
    logger.info(`API available at http://${HOST}:${PORT}`);
    logger.info(`WebSocket available at ws://${HOST}:${PORT}/socket.io`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error during startup');
  process.exit(1);
});
