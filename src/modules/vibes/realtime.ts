// In-process registry of open vibe-chat websocket connections, keyed by room.
// REST `sendChatMessage` persists a message then calls `broadcastToRoom` so every
// other connected member of that match/group room receives it instantly.
//
// Single-process only. Behind multiple instances this would need a Redis pub/sub
// fan-out; the hook (`broadcastToRoom`) is the one place to add that later.

export type VibeRoomType = 'partner' | 'group';

export interface RoomClient {
  userId: string;
  send: (data: string) => void;
}

const rooms = new Map<string, Set<RoomClient>>();

function roomKey(roomType: VibeRoomType, roomId: string): string {
  return `${roomType}:${roomId}`;
}

export function joinRoom(roomType: VibeRoomType, roomId: string, client: RoomClient): void {
  const key = roomKey(roomType, roomId);
  let set = rooms.get(key);
  if (!set) {
    set = new Set();
    rooms.set(key, set);
  }
  set.add(client);
}

export function leaveRoom(roomType: VibeRoomType, roomId: string, client: RoomClient): void {
  const key = roomKey(roomType, roomId);
  const set = rooms.get(key);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) rooms.delete(key);
}

export function broadcastToRoom(
  roomType: VibeRoomType,
  roomId: string,
  payload: unknown,
  opts: { exceptUserId?: string } = {},
): void {
  const set = rooms.get(roomKey(roomType, roomId));
  if (!set || set.size === 0) return;
  const data = JSON.stringify(payload);
  for (const client of set) {
    if (opts.exceptUserId && client.userId === opts.exceptUserId) continue;
    try {
      client.send(data);
    } catch {
      // Dead socket — it will be cleaned up on its close handler.
    }
  }
}
