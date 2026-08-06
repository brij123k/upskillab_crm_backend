import { Injectable } from '@nestjs/common';

@Injectable()
export class MessageQueueService {
  private sleep(ms: number) {
    return new Promise((resolve) =>
      setTimeout(resolve, ms),
    );
  }

  async processInBatches<T>(
    items: T[],
    batchSize: number,
    delay: number,
    callback: (item: T) => Promise<void>,
  ) {
    for (
      let i = 0;
      i < items.length;
      i += batchSize
    ) {
      const batch = items.slice(
        i,
        i + batchSize,
      );

      await Promise.all(
        batch.map((item) => callback(item)),
      );

      if (i + batchSize < items.length) {
        await this.sleep(delay);
      }
    }
  }
}