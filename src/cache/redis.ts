import { Redis, type RedisOptions } from "ioredis";

const createRedisConfig = (): RedisOptions => {
  const config: RedisOptions = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    db: parseInt(process.env.REDIS_DB || "0", 10),
    keyPrefix: "spotify:canvas:",
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  };

  if (process.env.REDIS_PASSWORD) {
    config.password = process.env.REDIS_PASSWORD;
  }

  return config;
};

const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days in seconds

export class RedisCache {
  private client: Redis;
  private isConnected = false;

  constructor() {
    this.client = new Redis(createRedisConfig());

    this.client.on("connect", () => {
      console.log("Redis connected");
      this.isConnected = true;
    });

    this.client.on("error", (error: Error) => {
      console.error("Redis error:", error);
      this.isConnected = false;
    });

    this.client.on("close", () => {
      console.log("Redis connection closed");
      this.isConnected = false;
    });
  }

  async get(key: string): Promise<string | null> {
    if (!this.isConnected) {
      console.warn("Redis not connected, skipping cache get");
      return null;
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      console.error("Redis get error:", error);
      return null;
    }
  }

  async set(
    key: string,
    value: string,
    ttl: number = DEFAULT_TTL,
  ): Promise<boolean> {
    if (!this.isConnected) {
      console.warn("Redis not connected, skipping cache set");
      return false;
    }

    try {
      await this.client.setex(key, ttl, value);
      return true;
    } catch (error) {
      console.error("Redis set error:", error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error("Redis del error:", error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error("Redis exists error:", error);
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.isConnected) {
      return -1;
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error("Redis ttl error:", error);
      return -1;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

export const redisCache = new RedisCache();
