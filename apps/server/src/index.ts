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
  const roomState = room.roomState();
  const gameState = room.gameState();
  console.info(`[room:${room.id}] emitting room:state players=${roomState.players.map((player) => `${player.name}:${player.id}:${player.connected ? "connected" : "disconnected"}`).join(",")} count=${roomState.players.length} status=${roomState.status} currentPlayerId=${roomState.currentPlayerId ?? "none"}`);
  io.to(channel(room.id)).emit("room:state", roomState);
  console.info(`[room:${room.id}] emitting game:state status=${gameState.status} players=${gameState.players.length} currentPlayerId=${gameState.currentPlayerId ?? "none"}`);
  io.to(channel(room.id)).emit("game:state", gameState);
  io.to(channel(room.id)).emit("game:snapshot", { roomId: room.id, balls: room.physics.snapshot(), moving: room.physics.isMoving(), events: [] });
}

notifyRoomChanged = sendRoomState;

function sendError(socket: Parameters<Parameters<typeof io.on>[1]>[0], error: RoomError): void {
  console.warn(`[socket] error socket.id=${socket.id} code=${error.code} message=${error.message}`);
  socket.emit("game:error", error);
}

io.on("connection", (socket) => {
  console.info(`[socket] connected socket.id=${socket.id}`);

  socket.on("room:create", async (payload) => {
    console.info(`[room:create] socket.id=${socket.id} playerId=${payload.playerId}`);
    const result = rooms.createRoom(socket.id, payload.playerId, payload);
    if ("error" in result) {
      sendError(socket, result.error);
      return;
    }
    await Promise.resolve(socket.join(channel(result.room.id)));
    console.info(`[room:${result.room.id}] created roomId=${result.room.id} playerId=${payload.playerId} players=${result.room.playerList.length}`);
    sendRoomState(result.room.id);
  });

  socket.on("room:join", async (payload) => {
    console.info(`[room:join] socket.id=${socket.id} roomId=${payload.roomId} playerId=${payload.playerId}`);
    const result = rooms.joinRoom(socket.id, payload);
    if ("error" in result) {
      sendError(socket, result.error);
      return;
    }
    await Promise.resolve(socket.join(channel(result.room.id)));
    const players = result.room.playerList.map((player) => `${player.name}:${player.id}`).join(",");
    console.info(`[room:${result.room.id}] after join players=[${players}] count=${result.room.playerList.length}`);
    if (result.room.status === "playing" && result.room.playerList.length === 2) {
      console.info(`[room:${result.room.id}] transition waiting -> playing currentPlayerId=${result.room.currentPlayerId}`);
    }
    sendRoomState(result.room.id);
  });

  socket.on("room:reconnect", async (payload) => {
    console.info(`[room:reconnect] socket.id=${socket.id} roomId=${payload.roomId} playerId=${payload.playerId}`);
    const result = rooms.reconnect(socket.id, payload.roomId, payload.playerId);
    if ("error" in result) {
      sendError(socket, result.error);
      return;
    }
    await Promise.resolve(socket.join(channel(result.room.id)));
    console.info(`[room:${result.room.id}] after reconnect players=${result.room.playerList.length}`);
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
    console.info(`[socket] disconnected socket.id=${socket.id}`);
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
