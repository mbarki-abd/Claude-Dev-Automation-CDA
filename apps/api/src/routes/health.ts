import { FastifyPluginAsync } from 'fastify';
import { testConnection as testDbConnection } from '../database/client.js';
import { testRedisConnection } from '../services/RedisService.js';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: {
      status: 'up' | 'down';
      latency?: number;
    };
    redis: {
      status: 'up' | 'down';
      latency?: number;
    };
  };
}

const startTime = Date.now();

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Simple liveness probe
  fastify.get('/api/health/live', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Detailed readiness probe
  fastify.get('/api/health/ready', async () => {
    const checks = await Promise.all([
      checkDatabase(),
      checkRedis(),
    ]);

    const [database, redis] = checks;
    const allHealthy = database.status === 'up' && redis.status === 'up';
    const anyDown = database.status === 'down' || redis.status === 'down';

    const response: HealthStatus = {
      status: allHealthy ? 'healthy' : anyDown ? 'unhealthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks: {
        database,
        redis,
      },
    };

    return response;
  });

  // Full health check
  fastify.get('/api/health', async () => {
    const checks = await Promise.all([
      checkDatabase(),
      checkRedis(),
    ]);

    const [database, redis] = checks;
    const allHealthy = database.status === 'up' && redis.status === 'up';

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      environment: process.env.NODE_ENV || 'development',
      checks: {
        database,
        redis,
      },
    };
  });
};

async function checkDatabase(): Promise<{ status: 'up' | 'down'; latency?: number }> {
  const start = Date.now();
  try {
    const healthy = await testDbConnection();
    return {
      status: healthy ? 'up' : 'down',
      latency: Date.now() - start,
    };
  } catch {
    return { status: 'down' };
  }
}

async function checkRedis(): Promise<{ status: 'up' | 'down'; latency?: number }> {
  const start = Date.now();
  try {
    const healthy = await testRedisConnection();
    return {
      status: healthy ? 'up' : 'down',
      latency: Date.now() - start,
    };
  } catch {
    return { status: 'down' };
  }
}
