import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { CallEventQueue, CallEventQueueSchema } from 'src/schema/call-event-queue.schema';

@Module({
    imports: [
      MongooseModule.forFeature([
        { name: CallEventQueue.name, schema: CallEventQueueSchema },
      ]),
    ],
  providers: [SocketGateway],
  exports: [SocketGateway], // 🔥 REQUIRED for cron / other modules
})
export class SocketModule {}
