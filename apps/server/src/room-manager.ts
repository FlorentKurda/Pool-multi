import { randomBytes } from "node:crypto";
import type { GameState, JoinRoomPayload, PhysicsShootPayload, Player, RoomState } from "@pool/game-core";
import { FIXED_DELTA_MS, PoolPhysics, type PhysicsEvent } from "./physics.js";
import { resolveShot, type PlayerGroup } from "./rules.js";

const ROOM_ID_LENGTH = 6;
const MAX_PLAYERS = 2;
const MAX_POWER = 14;
const DISCONNECT_GRACE_MS = 60_000;

export type RoomErrorCode = "INVALID_DATA" | "ROOM_NOT_FOUND" | "ROOM_FULL" | "PLAYER_IN_ROOM" | "NOT_IN_ROOM" | "NOT_YOUR_TURN" | "GAME_NOT_READY" | "TABLE_MOVING" | "INVALID_SHOT" | "PLAYER_DISCONNECTED" | "RECONNECT_NOT_FOUND" | "REMATCH_NOT_AVAILABLE";
export type RoomError = { code: RoomErrorCode; message: string };

export class GameRoom {
  readonly physics = new PoolPhysics();
  private readonly players = new Map<string, Player>();
  private readonly pendingPhysicsEvents: PhysicsEvent[] = [];
  private readonly groups: Record<string, PlayerGroup | null> = {};
  private shotInProgress = false;
  private shotPlayerId: string | null = null;
  private shotBeforeBalls = [] as ReturnType<PoolPhysics["snapshot"]>;
  private readonly pocketedThisShot = new Set<number>();
  private finished = false;
  winnerId: string | null = null;
  currentPlayerId: string | null = null;

  constructor(readonly id: string) {}

  get status(): GameState["status"] {
    if (this.finished) return "finished";
    if (this.players.size < MAX_PLAYERS) return "waiting";
    return "playing";
  }

  get playerList(): Player[] { return [...this.players.values()]; }

  addPlayer(id: string, name: string): RoomError | null {
    if (!id.trim() || id.trim().length > 128) return { code: "INVALID_DATA", message: "L'identifiant joueur est invalide." };
    if (!name.trim() || name.trim().length > 24) return { code: "INVALID_DATA", message: "Le pseudo doit contenir entre 1 et 24 caractères." };
    if (this.players.has(id)) return { code: "PLAYER_IN_ROOM", message: "Ce joueur est déjà dans cette room." };
    if (this.players.size >= MAX_PLAYERS) return { code: "ROOM_FULL", message: "Cette room contient déjà deux joueurs." };
    this.players.set(id, { id, name: name.trim(), connected: true });
    this.groups[id] = null;
    if (this.players.size === MAX_PLAYERS) this.currentPlayerId = this.playerList[0]?.id ?? null;
    return null;
  }

  connectPlayer(id: string): RoomError | null {
    const player = this.players.get(id);
    if (!player) return { code: "RECONNECT_NOT_FOUND", message: "La place de ce joueur n'existe plus dans cette room." };
    player.connected = true;
    return null;
  }

  disconnectPlayer(id: string): boolean {
    const player = this.players.get(id);
    if (!player) return false;
    player.connected = false;
    return true;
  }

  removePlayer(id: string): boolean {
    const removed = this.players.delete(id);
    delete this.groups[id];
    if (removed && this.currentPlayerId === id) this.currentPlayerId = this.playerList[0]?.id ?? null;
    return removed;
  }

  containsPlayer(id: string): boolean { return this.players.has(id); }
  isPlayerConnected(id: string): boolean { return this.players.get(id)?.connected ?? false; }

  acceptShot(playerId: string, payload: PhysicsShootPayload): RoomError | null {
    if (!this.containsPlayer(playerId)) return { code: "NOT_IN_ROOM", message: "Vous ne faites pas partie de cette room." };
    if (!this.isPlayerConnected(playerId)) return { code: "PLAYER_DISCONNECTED", message: "Reconnectez-vous avant de jouer." };
    if (this.status !== "playing") return { code: "GAME_NOT_READY", message: "La partie attend encore un second joueur ou est terminée." };
    if (this.playerList.some((player) => !player.connected)) return { code: "PLAYER_DISCONNECTED", message: "Attendez la reconnexion de votre adversaire." };
    if (this.currentPlayerId !== playerId) return { code: "NOT_YOUR_TURN", message: "Ce n'est pas votre tour." };
    if (!Number.isFinite(payload.angle) || !Number.isFinite(payload.power) || payload.power <= 0 || payload.power > MAX_POWER) return { code: "INVALID_SHOT", message: "Les paramètres du tir sont invalides." };
    if (this.physics.isMoving() || this.shotInProgress) return { code: "TABLE_MOVING", message: "Attendez que les boules soient arrêtées." };
    if (!this.physics.shoot(payload.angle, payload.power)) return { code: "INVALID_SHOT", message: "Le tir n'a pas pu être appliqué." };
    this.physics.drainEvents();
    this.pendingPhysicsEvents.splice(0, this.pendingPhysicsEvents.length);
    this.pocketedThisShot.clear();
    this.shotBeforeBalls = this.physics.snapshot();
    this.shotPlayerId = playerId;
    this.shotInProgress = true;
    return null;
  }

  rematch(requestingPlayerId: string): RoomError | null {
    if (this.status !== "finished" || !this.containsPlayer(requestingPlayerId)) return { code: "REMATCH_NOT_AVAILABLE", message: "La revanche sera disponible à la fin de la partie." };
    if (this.playerList.some((player) => !player.connected)) return { code: "PLAYER_DISCONNECTED", message: "Les deux joueurs doivent être connectés pour lancer une revanche." };
    this.physics.reset();
    this.pendingPhysicsEvents.splice(0, this.pendingPhysicsEvents.length);
    this.pocketedThisShot.clear();
    for (const player of this.playerList) this.groups[player.id] = null;
    this.finished = false;
    this.winnerId = null;
    this.currentPlayerId = this.playerList[0]?.id ?? null;
    return null;
  }

  tick(deltaMs = FIXED_DELTA_MS): boolean {
    if (!this.physics.isMoving()) return false;
    this.physics.step(deltaMs);
    this.collectPhysicsEvents();
    if (this.shotInProgress && !this.physics.isMoving()) this.finishShot();
    return true;
  }

  drainPhysicsEvents(): PhysicsEvent[] { return this.pendingPhysicsEvents.splice(0, this.pendingPhysicsEvents.length); }
  roomState(): RoomState { return { roomId: this.id, status: this.status, players: this.playerList, currentPlayerId: this.currentPlayerId }; }
  gameState(): GameState { return { roomId: this.id, status: this.status, players: this.playerList, currentPlayerId: this.currentPlayerId, balls: this.physics.snapshot(), groups: { ...this.groups }, winnerId: this.winnerId }; }

  private collectPhysicsEvents(): void {
    const events = this.physics.drainEvents();
    this.pendingPhysicsEvents.push(...events);
    for (const event of events) if (event.type === "ball-pocketed") this.pocketedThisShot.add(event.ballId);
  }

  private finishShot(): void {
    if (!this.shotPlayerId) return;
    const opponent = this.playerList.find((player) => player.id !== this.shotPlayerId)?.id ?? null;
    const resolution = resolveShot({ groups: { ...this.groups }, winnerId: this.winnerId, status: this.status, currentPlayerId: this.currentPlayerId }, this.shotPlayerId, opponent, this.shotBeforeBalls, [...this.pocketedThisShot]);
    for (const [playerId, group] of Object.entries(resolution.state.groups)) this.groups[playerId] = group;
    this.winnerId = resolution.state.winnerId;
    this.finished = resolution.state.status === "finished";
    this.currentPlayerId = resolution.state.currentPlayerId;
    if (resolution.respawnCueBall) this.physics.respawnCueBall();
    this.shotInProgress = false;
    this.shotPlayerId = null;
    this.pocketedThisShot.clear();
  }
}

type Connection = { socketId: string; playerId: string; roomId: string };

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly connections = new Map<string, Connection>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly onRoomChanged: (roomId: string) => void = () => undefined) {}

  createRoom(socketId: string, playerId: string, payload: { playerName: string }): { room: GameRoom } | { error: RoomError } {
    const room = new GameRoom(this.generateRoomId());
    const error = room.addPlayer(playerId, payload.playerName);
    if (error) return { error };
    this.rooms.set(room.id, room);
    this.attach(socketId, playerId, room.id);
    return { room };
  }

  joinRoom(socketId: string, payload: JoinRoomPayload): { room: GameRoom } | { error: RoomError } {
    if (!payload.roomId.trim()) return { error: { code: "INVALID_DATA", message: "L'identifiant de room est requis." } };
    const room = this.rooms.get(payload.roomId.trim().toUpperCase());
    if (!room) return { error: { code: "ROOM_NOT_FOUND", message: "Cette room n'existe pas." } };
    const existingRoom = this.findByPlayerId(payload.playerId);
    if (existingRoom && existingRoom.id !== room.id) return { error: { code: "PLAYER_IN_ROOM", message: "Ce joueur est déjà dans une autre room." } };
    if (existingRoom) return { error: { code: "PLAYER_IN_ROOM", message: "Utilisez la reconnexion pour retrouver cette room." } };
    const error = room.addPlayer(payload.playerId, payload.playerName);
    if (error) return { error };
    this.attach(socketId, payload.playerId, room.id);
    return { room };
  }

  reconnect(socketId: string, roomId: string, playerId: string): { room: GameRoom } | { error: RoomError } {
    const room = this.rooms.get(roomId.trim().toUpperCase());
    if (!room || !room.containsPlayer(playerId)) return { error: { code: "RECONNECT_NOT_FOUND", message: "Aucune session à reprendre dans cette room." } };
    const error = room.connectPlayer(playerId);
    if (error) return { error };
    this.clearExpiry(room.id, playerId);
    this.attach(socketId, playerId, room.id);
    return { room };
  }

  findBySocket(socketId: string): GameRoom | undefined {
    const connection = this.connections.get(socketId);
    return connection ? this.rooms.get(connection.roomId) : undefined;
  }

  playerIdForSocket(socketId: string): string | undefined { return this.connections.get(socketId)?.playerId; }

  findByPlayerId(playerId: string): GameRoom | undefined { return [...this.rooms.values()].find((room) => room.containsPlayer(playerId)); }

  disconnectSocket(socketId: string): GameRoom | undefined {
    const connection = this.connections.get(socketId);
    if (!connection) return undefined;
    this.connections.delete(socketId);
    const room = this.rooms.get(connection.roomId);
    if (!room || !room.disconnectPlayer(connection.playerId)) return room;
    const timerKey = `${room.id}:${connection.playerId}`;
    this.clearExpiry(room.id, connection.playerId);
    this.expiryTimers.set(timerKey, setTimeout(() => {
      if (!room.isPlayerConnected(connection.playerId)) {
        room.removePlayer(connection.playerId);
        if (room.playerList.length === 0) this.rooms.delete(room.id);
        this.onRoomChanged(room.id);
      }
      this.expiryTimers.delete(timerKey);
    }, DISCONNECT_GRACE_MS));
    return room;
  }

  removePlayer(playerId: string): GameRoom | undefined {
    const room = this.findByPlayerId(playerId);
    if (!room) return undefined;
    room.removePlayer(playerId);
    for (const [socketId, connection] of this.connections) if (connection.playerId === playerId) this.connections.delete(socketId);
    this.clearExpiry(room.id, playerId);
    if (room.playerList.length === 0) this.rooms.delete(room.id);
    return room;
  }

  allRooms(): GameRoom[] { return [...this.rooms.values()]; }

  private attach(socketId: string, playerId: string, roomId: string): void {
    for (const [oldSocketId, connection] of this.connections) if (connection.playerId === playerId) this.connections.delete(oldSocketId);
    this.connections.set(socketId, { socketId, playerId, roomId });
  }

  private clearExpiry(roomId: string, playerId: string): void {
    const key = `${roomId}:${playerId}`;
    const timer = this.expiryTimers.get(key);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(key);
  }

  private generateRoomId(): string {
    let id = "";
    do id = randomBytes(ROOM_ID_LENGTH).toString("base64url").slice(0, ROOM_ID_LENGTH).toUpperCase(); while (this.rooms.has(id));
    return id;
  }
}

export { DISCONNECT_GRACE_MS };
