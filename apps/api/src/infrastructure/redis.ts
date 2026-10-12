import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../observability/logger';

export let redis: Redis | null = null;
export let redis2: Redis | null = null;
export let redis3: Redis | null = null;
export let redis4: Redis | null = null;

function createRedisClient(url: string | undefined, name: string): Redis | null {
  if (!url) return null;
  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 100, 3000);
      }
    });

    client.on('error', (err) => {
      logger.error(`${name} connection error`, { error: err.message });
    });

    client.on('connect', () => {
      logger.info(`Connected to ${name} successfully`);
    });

    return client;
  } catch (error) {
    logger.error(`Failed to initialize ${name}`, { error });
    return null;
  }
}

redis = createRedisClient(env.redisUrl, 'Redis Primary');
redis2 = createRedisClient(env.redisUrl2, 'Redis Secondary');
redis3 = createRedisClient(env.redisUrl3, 'Redis Mesago');
redis4 = createRedisClient(env.redisUrl4, 'Redis Mesago 2');

export async function checkRedis(client: Redis | null = redis, envName = 'REDIS_URL'): Promise<{ connected: boolean; error?: string }> {
  if (!client) {
    return { connected: false, error: `${envName} not configured` };
  }

  try {
    await client.ping();
    return { connected: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Redis error';
    return { connected: false, error: message };
  }
}

export async function getRedisMetrics(client: Redis | null = redis) {
  if (!client) {
    return null;
  }

  try {
    const info = await client.info();
    const parse = (key: string): string | null => {
      const regex = new RegExp('^' + key + ':(.+)$', 'm');
      const match = info.match(regex);
      return match ? match[1].trim() : null;
    };

    const usedMemory = Number(parse('used_memory') || 0);
    let maxMemory = Number(parse('maxmemory') || 0);
    const peakMemory = Number(parse('used_memory_peak') || 0);

    if (maxMemory === 0) {
      maxMemory = 30 * 1024 * 1024;
    }

    const totalKeys = await client.dbsize();

    const hits = Number(parse('keyspace_hits') || 0);
    const misses = Number(parse('keyspace_misses') || 0);
    const hitTotal = hits + misses;

    return {
      memory: {
        used_bytes: usedMemory,
        used_mb: +(usedMemory / 1024 / 1024).toFixed(1),
        peak_mb: +(peakMemory / 1024 / 1024).toFixed(1),
        max_bytes: maxMemory,
        max_mb: +(maxMemory / 1024 / 1024).toFixed(0),
        usage_pct: maxMemory > 0 ? +((usedMemory / maxMemory) * 100).toFixed(1) : null,
      },
      clients: {
        connected: Number(parse('connected_clients') || 0),
        blocked: Number(parse('blocked_clients') || 0),
      },
      stats: {
        total_commands: Number(parse('total_commands_processed') || 0),
        ops_per_sec: Number(parse('instantaneous_ops_per_sec') || 0),
        hit_rate: hitTotal > 0 ? +((hits / hitTotal) * 100).toFixed(1) : null,
        total_keys: totalKeys,
      },
      server: {
        version: parse('redis_version'),
        uptime_seconds: Number(parse('uptime_in_seconds') || 0),
        uptime_days: Number(parse('uptime_in_days') || 0),
      },
    };
  } catch {
    return null;
  }
}
