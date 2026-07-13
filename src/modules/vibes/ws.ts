// Realtime websocket for vibe chat. A client connects to:
//   /ws/vibes?token=<accessJwt>&roomType=partner|group&roomId=<uuid>
// We authenticate the JWT, verify the user belongs to that match/group room,
// then register the socket so REST `sendChatMessage` can fan messages out to it.

import { createNodeWebSocket } from '@hono/node-ws';
import type { Hono } from 'hono';
import type { ServerType } from '@hono/node-server';

import { env } from '../../config/env.js';
import { verifyJwt } from '../../lib/jwt.js';
import { findSessionById } from '../auth/repository.js';
import { db } from '../../db/client.js';
import type { AppEnv } from '../../types/context.js';
import type { JwtTokenClaims } from '../../types/auth.js';
import { assertRoomAccess } from './service.js';
import { joinRoom, leaveRoom, type RoomClient, type VibeRoomType } from './realtime.js';

let injectFn: ((server: ServerType) => void) | null = null;

export function registerVibesWebSocket(app: Hono<AppEnv>): void {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  injectFn = injectWebSocket;

  app.get(
    '/ws/vibes',
    upgradeWebSocket((c) => {
      const token = c.req.query('token') ?? '';
      const roomType = (c.req.query('roomType') ?? '') as VibeRoomType;
      const roomId = c.req.query('roomId') ?? '';
      let client: RoomClient | null = null;

      return {
        onOpen: async (_evt, ws) => {
          try {
            if (roomType !== 'partner' && roomType !== 'group') throw new Error('bad room');
            const payload = verifyJwt<JwtTokenClaims>(token, env.ACCESS_TOKEN_SECRET, 'access');
            if (!payload?.sub || !payload?.sid) throw new Error('bad token');
            const session = await findSessionById(db, payload.sid);
            if (!session || session.userId !== payload.sub || session.expiresAt.getTime() <= Date.now()) {
              throw new Error('bad session');
            }
            // Throws unless the user is in this match/group room.
            await assertRoomAccess(payload.sub, roomType, roomId);
            client = { userId: payload.sub, send: (data: string) => ws.send(data) };
            joinRoom(roomType, roomId, client);
            ws.send(JSON.stringify({ type: 'ready', roomType, roomId }));
          } catch {
            try {
              ws.send(JSON.stringify({ type: 'error', message: 'unauthorized' }));
            } catch {
              // socket already gone
            }
            ws.close(1008, 'unauthorized');
          }
        },
        onClose: () => {
          if (client) leaveRoom(roomType, roomId, client);
        },
        onError: () => {
          if (client) leaveRoom(roomType, roomId, client);
        },
      };
    }),
  );
}

/** Attach the websocket upgrade handler to the running node server (called from index.ts). */
export function injectVibesWebSocket(server: ServerType): void {
  injectFn?.(server);
}
