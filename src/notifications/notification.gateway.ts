import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: '*' },
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) throw new Error('No token');

      const payload = this.jwtService.verify(token);
        // console.log(payload)
      const {userId, roleName } = payload;
      client.join(`user:${userId}`);
      client.join(`role:${roleName}`);

      client.data.userId = userId;

      // console.log(`🔌 User connected: ${userId}`);
    } catch (err) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // console.log(`❌ User disconnected: ${client.data?.userId}`);
  }

  /* ===========================
     Client → Server Events
  ============================ */

  // @SubscribeMessage('notification:read')
  // async markAsRead(client: Socket, payload: { notificationId: string }) {
  //   await this.notificationService.markAsRead(client.data.userId,payload.notificationId)

  //   this.server
  //     .to(`user:${client.data.userId}`)
  //     .emit('notification:read-confirm', payload.notificationId);
  // }

  // @SubscribeMessage('notification:read-all')
  // async markAllAsRead(client: Socket) {
  //   // Mark all notifications as read

  //   this.server
  //     .to(`user:${client.data.userId}`)
  //     .emit('notification:read-confirm', 'ALL');
  // }


  emitToUser(userId: string, notification: any) {
  this.server
    .to(`user:${userId}`)
    .emit('notification:new', notification);
}
emitUnreadCount(userId: string, count: number) {
  this.server
    .to(`user:${userId}`)
    .emit('notification:count', count);
}
}
