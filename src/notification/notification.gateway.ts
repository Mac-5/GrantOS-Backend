import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

/**
 * Build the WebSocket CORS allow-list. `FRONTEND_URL` may be a single origin
 * or a comma-separated list (e.g. local + deployed). `localhost:3000` is
 * always allowed for dev, and a literal `*` opens it to any origin. Without
 * this, a deployed frontend whose origin didn't exactly match a single
 * hard-coded `FRONTEND_URL` had its socket handshake blocked, so live
 * notifications silently never connected.
 */
function buildAllowedOrigins(): string[] {
  const fromEnv = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([...fromEnv, 'http://localhost:3000']));
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

@WebSocketGateway({
  cors: {
    origin: (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Non-browser clients (no Origin header) and allow-listed origins pass.
      if (
        !origin ||
        ALLOWED_ORIGINS.includes('*') ||
        ALLOWED_ORIGINS.includes(origin)
      ) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
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
