import Redis from 'ioredis';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('redis');

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 10) {
          logger.error('Redis connection failed after 10 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    redis.on('connect', () => {
      logger.info('Connected to Redis');
    });

    redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
    });
  }

  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis connection closed');
  }
}

export async function testRedisConnection(): Promise<boolean> {
  try {
    const result = await getRedis().ping();
    logger.info({ result }, 'Redis connection successful');
    return result === 'PONG';
  } catch (error) {
    logger.error({ error }, 'Redis connection failed');
    return false;
  }
}

// Cache utilities
export async function setCache(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await getRedis().setex(key, ttlSeconds, serialized);
  } else {
    await getRedis().set(key, serialized);
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  const value = await getRedis().get(key);
  if (!value) return null;
  return JSON.parse(value) as T;
}

export async function deleteCache(key: string): Promise<void> {
  await getRedis().del(key);
}

export async function invalidatePattern(pattern: string): Promise<void> {
  const keys = await getRedis().keys(pattern);
  if (keys.length > 0) {
    await getRedis().del(...keys);
  }
}

// Session utilities
export async function setSession(sessionId: string, data: unknown, ttlSeconds = 3600): Promise<void> {
  await setCache(`session:${sessionId}`, data, ttlSeconds);
}

export async function getSession<T>(sessionId: string): Promise<T | null> {
  return getCache<T>(`session:${sessionId}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await deleteCache(`session:${sessionId}`);
}

// Real-time state
export async function setExecutionState(executionId: string, state: unknown): Promise<void> {
  await setCache(`execution:${executionId}:state`, state, 3600);
}

export async function getExecutionState<T>(executionId: string): Promise<T | null> {
  return getCache<T>(`execution:${executionId}:state`);
}

// Pub/Sub for real-time updates
export function createSubscriber(): Redis {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  return new Redis(redisUrl);
}

export async function publish(channel: string, message: unknown): Promise<void> {
  await getRedis().publish(channel, JSON.stringify(message));
}
