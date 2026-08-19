"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { BallState, ClientToServerEvents, GameState, RoomState, ServerToClientEvents } from "@pool/game-core";
import { createRack } from "@pool/game-core";
import { PoolTable } from "../../pool-table";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

export function GameClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [balls, setBalls] = useState<BallState[]>(createRack());
  const [moving, setMoving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const fallbackSocket = useMemo(() => io(SERVER_URL, { autoConnect: false }), []);

  useEffect(() => {
    const storedName = window.sessionStorage.getItem("pool-player-name") ?? "";
    const storedPlayerId = window.localStorage.getItem("pool-player-id") ?? crypto.randomUUID();
    window.localStorage.setItem("pool-player-id", storedPlayerId);
    setName(storedName);
    setPlayerId(storedPlayerId);
  }, []);

  useEffect(() => {
    if (!name.trim() || !playerId) return;
    const nextSocket = io(SERVER_URL);
    setSocket(nextSocket);
    nextSocket.on("connect", () => {
      setConnected(true);
      if (roomId === "NEW") nextSocket.emit("room:create", { playerId, playerName: name });
      else nextSocket.emit("room:reconnect", { roomId, playerId });
    });
    nextSocket.on("disconnect", () => setConnected(false));
    nextSocket.on("room:state", (nextRoom) => {
      setRoom(nextRoom);
      setError("");
      window.localStorage.setItem("pool-room-id", nextRoom.roomId);
      if (roomId === "NEW") router.replace(`/game/${nextRoom.roomId}`);
    });
    nextSocket.on("game:snapshot", (snapshot) => {
      setBalls(snapshot.balls);
      setMoving(snapshot.moving);
    });
    nextSocket.on("game:state", (nextGame) => setGame(nextGame));
    nextSocket.on("game:error", (nextError) => {
      if (nextError.code === "RECONNECT_NOT_FOUND" && roomId !== "NEW") {
        nextSocket.emit("room:join", { roomId, playerId, playerName: name });
        return;
      }
      setError(nextError.message);
    });
    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [name, playerId, roomId, router]);

  const ownPlayerId = playerId;
  const canShoot = Boolean(connected && room?.status === "playing" && room.currentPlayerId === ownPlayerId && !moving);
  const inviteUrl = typeof window === "undefined" ? "" : `${window.location.origin}/game/${room?.roomId ?? roomId}`;
  const opponent = useMemo(() => room?.players.find((player) => player.id !== ownPlayerId), [room?.players, ownPlayerId]);
  const currentPlayer = room?.players.find((player) => player.id === room.currentPlayerId);
  const ownGroup = ownPlayerId && game?.groups[ownPlayerId] ? game.groups[ownPlayerId] : null;
  const opponentGroup = opponent && game?.groups[opponent.id] ? game.groups[opponent.id] : null;

  if (!name) {
    return <main className="page-shell lobby-shell"><section className="lobby-card"><h2>Choisissez un pseudo</h2><p className="intro">Il sera visible par votre adversaire.</p><button type="button" onClick={() => { const nextName = window.prompt("Votre pseudo"); if (nextName?.trim()) { window.sessionStorage.setItem("pool-player-name", nextName.trim()); setName(nextName.trim()); } }}>Continuer</button></section></main>;
  }

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main className="page-shell game-shell">
      <header className="game-header">
        <div><p className="eyebrow">ROOM · {room?.roomId ?? roomId}</p><h2>Table de billard</h2></div>
        <span className={connected ? "connection connected" : "connection"}>{connected ? "Connecté" : "Connexion…"}</span>
      </header>
      {error && <p className="error-message">{error}</p>}
      <section className="players-bar">
        <div className={room?.currentPlayerId === ownPlayerId ? "player-chip active-player" : "player-chip"}><strong>{name}</strong><span>{ownGroup ? `Boules ${ownGroup === "solid" ? "pleines" : "rayées"}` : "Groupe non attribué"}</span><small>{room?.currentPlayerId === ownPlayerId ? "À vous" : "Joueur"}</small></div>
        <div className="turn-message">{room?.status === "waiting" ? "En attente d'un adversaire" : currentPlayer ? `Tour de ${currentPlayer.name}` : "Préparation de la partie"}</div>
        <div className="player-chip opponent-chip"><strong>{opponent?.name ?? "Adversaire"}</strong><span>{opponentGroup ? `Boules ${opponentGroup === "solid" ? "pleines" : "rayées"}` : opponent ? "Groupe non attribué" : "Lien à partager"}</span><small>{opponent && room?.currentPlayerId === opponent.id ? "À lui/elle" : "Joueur"}</small></div>
      </section>
      {room?.status === "finished" && <div className={game?.winnerId === ownPlayerId ? "winner-banner victory" : "winner-banner defeat"}>{game?.winnerId === ownPlayerId ? "Victoire !" : "Défaite"}<span>{game?.winnerId === ownPlayerId ? "La table est à vous." : "Bonne chance pour la prochaine."}</span><button type="button" onClick={() => socket?.emit("game:rematch", { roomId: room?.roomId ?? roomId, playerId })}>Lancer une revanche</button></div>}
      <section className="table-card" aria-label="Table de billard américaine"><PoolTable socket={socket ?? fallbackSocket} connected={connected} canShoot={canShoot} moving={moving} balls={balls} /></section>
      {room?.status === "waiting" && <section className="invite-card"><p>Invitez votre adversaire avec ce lien</p><code>{inviteUrl}</code><button type="button" onClick={copyInvite}>{copied ? "Lien copié" : "Copier le lien"}</button></section>}
    </main>
  );
}
