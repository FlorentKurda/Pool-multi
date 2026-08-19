import { describe, expect, it } from "vitest";
import { RoomManager } from "./room-manager.js";

describe("RoomManager", () => {
  it("crée une room courte et la remplit avec deux joueurs maximum", () => {
    const manager = new RoomManager();
    const created = manager.createRoom("socket-a", "player-a", { playerName: "Alice" });
    expect("room" in created).toBe(true);
    if (!("room" in created)) return;

    expect(created.room.id).toHaveLength(6);
    expect(manager.joinRoom("socket-b", { roomId: created.room.id, playerId: "player-b", playerName: "Bob" })).toHaveProperty("room");
    expect(manager.joinRoom("socket-c", { roomId: created.room.id, playerId: "player-c", playerName: "Chloé" })).toEqual({ error: expect.objectContaining({ code: "ROOM_FULL" }) });
  });

  it("refuse une room inconnue", () => {
    const result = new RoomManager().joinRoom("socket-a", { roomId: "NOPE99", playerId: "player-a", playerName: "Alice" });
    expect(result).toEqual({ error: expect.objectContaining({ code: "ROOM_NOT_FOUND" }) });
  });

  it("autorise uniquement le joueur actif à tirer", () => {
    const manager = new RoomManager();
    const created = manager.createRoom("socket-a", "player-a", { playerName: "Alice" });
    if (!("room" in created)) throw new Error("room creation failed");
    manager.joinRoom("socket-b", { roomId: created.room.id, playerId: "player-b", playerName: "Bob" });

    expect(created.room.currentPlayerId).toBe("player-a");
    expect(created.room.acceptShot("player-b", { angle: 0, power: 5 })).toEqual(expect.objectContaining({ code: "NOT_YOUR_TURN" }));
    expect(created.room.acceptShot("player-a", { angle: 0, power: 5 })).toBeNull();
    expect(created.room.acceptShot("player-a", { angle: 0, power: 5 })).toEqual(expect.objectContaining({ code: "TABLE_MOVING" }));
  });

  it("valide les données de tir côté serveur", () => {
    const manager = new RoomManager();
    const created = manager.createRoom("socket-a", "player-a", { playerName: "Alice" });
    if (!("room" in created)) throw new Error("room creation failed");
    manager.joinRoom("socket-b", { roomId: created.room.id, playerId: "player-b", playerName: "Bob" });

    expect(created.room.acceptShot("player-a", { angle: Number.NaN, power: 5 })).toEqual(expect.objectContaining({ code: "INVALID_SHOT" }));
    expect(created.room.acceptShot("player-a", { angle: 0, power: 15 })).toEqual(expect.objectContaining({ code: "INVALID_SHOT" }));
  });

  it("conserve une place déconnectée et la récupère avec un nouveau socket", () => {
    const manager = new RoomManager();
    const created = manager.createRoom("socket-a", "player-a", { playerName: "Alice" });
    if (!("room" in created)) throw new Error("room creation failed");
    manager.joinRoom("socket-b", { roomId: created.room.id, playerId: "player-b", playerName: "Bob" });

    manager.disconnectSocket("socket-a");
    expect(created.room.playerList.find((player) => player.id === "player-a")?.connected).toBe(false);
    expect(manager.reconnect("socket-a-new", created.room.id, "player-a")).toHaveProperty("room");
    expect(created.room.playerList.find((player) => player.id === "player-a")?.connected).toBe(true);
  });

  it("refuse une revanche avant la fin de la partie", () => {
    const manager = new RoomManager();
    const created = manager.createRoom("socket-a", "player-a", { playerName: "Alice" });
    if (!("room" in created)) throw new Error("room creation failed");

    expect(created.room.rematch("player-a")).toEqual(expect.objectContaining({ code: "REMATCH_NOT_AVAILABLE" }));
  });

  it("démarre automatiquement la partie au deuxième joueur", () => {
    const manager = new RoomManager();
    const created = manager.createRoom("socket-a", "player-a", { playerName: "Alice" });
    if (!("room" in created)) throw new Error("room creation failed");

    expect(created.room.status).toBe("waiting");
    manager.joinRoom("socket-b", { roomId: created.room.id, playerId: "player-b", playerName: "Bob" });

    expect(created.room.status).toBe("playing");
    expect(created.room.currentPlayerId).toBe("player-a");
    expect(created.room.roomState().players).toHaveLength(2);
    expect(created.room.gameState().status).toBe("playing");
  });
});
