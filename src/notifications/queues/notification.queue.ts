import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const redisConnection = new IORedis({
  host: '127.0.0.1',
  port: 6379,
});

export const notificationQueue = new Queue('notification-queue', {
  connection: redisConnection,
});
