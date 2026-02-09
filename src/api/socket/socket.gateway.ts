import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*', // 🔒 restrict in production
  },
})
export class SocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) throw new Error('No token');

      const payload = this.jwtService.verify(token);
      const { userId, roleName } = payload;

      // Join rooms
      client.join(`user:${userId}`);
      if (roleName) {
        client.join(`role:${roleName}`);
      }

      client.data.userId = userId;

      console.log(`🟢 Socket connected | userId=${userId}`);
    } catch (error) {
      console.error('Socket connection error', error.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      console.log(`🔴 Socket disconnected | userId=${userId}`);
    }
  }

  emitToUser(userId: string, event: string, payload: any) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
  emitToRole(roleName: string, event: string, payload: any) {
    this.server.to(`role:${roleName}`).emit(event, payload);
  }
}
