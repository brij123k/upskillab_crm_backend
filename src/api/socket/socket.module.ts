import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';

@Module({
  providers: [SocketGateway],
  exports: [SocketGateway], // 🔥 REQUIRED for cron / other modules
})
export class SocketModule {}
