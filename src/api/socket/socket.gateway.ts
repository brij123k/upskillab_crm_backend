import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Model } from 'mongoose';
import { Server, Socket } from 'socket.io';
import { CallEventQueue } from 'src/schema/call-event-queue.schema';

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

  constructor(private readonly jwtService: JwtService,
  @InjectModel(CallEventQueue.name)
  private readonly callEventQueueModel: Model<CallEventQueue>,
  ) {}

 async handleConnection(client: Socket) {
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

      const item = await this.callEventQueueModel.findOne({ userId });
      if(item){
        client.emit(item.event, item.payload);
        await this.callEventQueueModel.deleteMany({ userId });
      }

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

  async emitCallEvent(userId: string, event: string, payload: any) {
  // 🔍 Check if user is online
  const sockets = await this.server.in(`user:${userId}`).fetchSockets();

  if (sockets.length > 0) {
    // ✅ User online → send directly
    this.server.to(`user:${userId}`).emit(event, payload);
  } else {
    // ❌ User offline → store in queue
    await this.callEventQueueModel.create({
      userId,
      event,
      payload,
    });

    console.log('📦 Stored in offline queue:', userId);
  }
}
}
