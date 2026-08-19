import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@pool/game-core";
import { FIXED_DELTA_MS } from "./physics.js";
import { RoomManager, type RoomError } from "./room-manager.js";

const port = Number(process.env.PORT ?? 3001);
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: frontendUrl },
});
let notifyRoomChanged: (roomId: string) => void = () => undefined;
const rooms = new RoomManager((roomId) => notifyRoomChanged(roomId));

function channel(roomId: string): string {
  return `room:${roomId}`;
}

function sendRoomState(roomId: string): void {
  const room = rooms.allRooms().find((candidate) => candidate.id === roomId);
  if (!room) return;
  io.to(channel(room.id)).emit("room:state", room.roomState());
  io.to(channel(room.id)).emit("game:state", room.gameState());
  io.to(channel(room.id)).emit("game:snapshot", { roomId: room.id, balls: room.physics.snapshot(), moving: room.physics.isMoving(), events: [] });
}

notifyRoomChanged = sendRoomState;

function sendError(socket: Parameters<Parameters<typeof io.on>[1]>[0], error: RoomError): void {
  socket.emit("game:error", error);
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload) => {
    const result = rooms.createRoom(socket.id, payload.playerId, payload);
    if ("error" in result) {
      sendError(socket, result.error);
      return;
    }
    socket.join(channel(result.room.id));
    sendRoomState(result.room.id);
  });

  socket.on("room:join", (payload) => {
    const result = rooms.joinRoom(socket.id, payload);
    if ("error" in result) {
      sendError(socket, result.error);
      return;
    }
    socket.join(channel(result.room.id));
    sendRoomState(result.room.id);
  });

  socket.on("room:reconnect", (payload) => {
    const result = rooms.reconnect(socket.id, payload.roomId, payload.playerId);
    if ("error" in result) {
      sendError(socket, result.error);
      return;
    }
    socket.join(channel(result.room.id));
    sendRoomState(result.room.id);
  });

  socket.on("physics:shoot", (payload) => {
    const room = rooms.findBySocket(socket.id);
    if (!room) {
      sendError(socket, { code: "NOT_IN_ROOM", message: "Rejoignez une room avant de tirer." });
      return;
    }
    const playerId = rooms.playerIdForSocket(socket.id);
    if (!playerId) {
      sendError(socket, { code: "NOT_IN_ROOM", message: "Rejoignez une room avant de tirer." });
      return;
    }
    const error = room.acceptShot(playerId, payload);
    if (error) {
      sendError(socket, error);
      return;
    }
    io.to(channel(room.id)).emit("game:snapshot", { roomId: room.id, balls: room.physics.snapshot(), moving: true, events: room.drainPhysicsEvents() });
  });

  socket.on("game:rematch", (payload) => {
    const room = rooms.findBySocket(socket.id);
    const playerId = rooms.playerIdForSocket(socket.id);
    if (!room || !playerId || room.id !== payload.roomId) {
      sendError(socket, { code: "NOT_IN_ROOM", message: "Rejoignez une room avant de demander une revanche." });
      return;
    }
    const error = room.rematch(playerId);
    if (error) {
      sendError(socket, error);
      return;
    }
    sendRoomState(room.id);
  });

  socket.on("disconnect", () => {
    const room = rooms.disconnectSocket(socket.id);
    if (room) sendRoomState(room.id);
  });
});

setInterval(() => {
  for (const room of rooms.allRooms()) {
    if (!room.tick(FIXED_DELTA_MS)) continue;
    io.to(channel(room.id)).emit("game:snapshot", { roomId: room.id, balls: room.physics.snapshot(), moving: room.physics.isMoving(), events: room.drainPhysicsEvents() });
    if (!room.physics.isMoving()) sendRoomState(room.id);
  }
}, FIXED_DELTA_MS);

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Pool server listening on 0.0.0.0:${port}`);
});
