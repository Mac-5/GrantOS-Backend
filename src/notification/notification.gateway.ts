import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/notifications',
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);
  private readonly addressToSockets = new Map<string, Set<string>>();

  handleConnection(client: Socket) {
    const address = client.handshake.query.address as string;
    if (!address) {
      this.logger.warn(`Client ${client.id} connected without address`);
      client.disconnect();
      return;
    }

    const normalizedAddress = address.toLowerCase();
    if (!this.addressToSockets.has(normalizedAddress)) {
      this.addressToSockets.set(normalizedAddress, new Set());
    }
    this.addressToSockets.get(normalizedAddress)!.add(client.id);

    client.join(`address:${normalizedAddress}`);
    this.logger.log(
      `Client ${client.id} connected for address ${normalizedAddress}`,
    );
  }

  handleDisconnect(client: Socket) {
    const address = client.handshake.query.address as string;
    if (address) {
      const normalizedAddress = address.toLowerCase();
      const sockets = this.addressToSockets.get(normalizedAddress);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.addressToSockets.delete(normalizedAddress);
        }
      }
      this.logger.log(
        `Client ${client.id} disconnected from address ${normalizedAddress}`,
      );
    }
  }

  notifyUser(address: string, notification: any) {
    const normalizedAddress = address.toLowerCase();
    this.server
      .to(`address:${normalizedAddress}`)
      .emit('notification', notification);
    this.logger.log(`Sent notification to address ${normalizedAddress}`);
  }

  notifyUnreadCount(address: string, count: number) {
    const normalizedAddress = address.toLowerCase();
    this.server
      .to(`address:${normalizedAddress}`)
      .emit('unread-count', { count });
  }
}
