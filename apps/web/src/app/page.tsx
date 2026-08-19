"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");

  const enterRoom = (destination: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    window.sessionStorage.setItem("pool-player-name", trimmedName);
    router.push(destination);
  };

  return (
    <main className="page-shell lobby-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">POOL MULTIPLAYER · PHASE 6</p>
          <h1>La prochaine casse<br /><span>se joue à deux.</span></h1>
        </div>
        <p className="intro">Créez une table, partagez son lien et jouez directement dans votre navigateur.</p>
      </section>
      <section className="lobby-card">
        <label htmlFor="player-name">Votre pseudo</label>
        <input id="player-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Camille" maxLength={24} autoComplete="nickname" />
        <button type="button" onClick={() => enterRoom("/game/new")} disabled={!name.trim()}>Créer une partie</button>
        <div className="join-divider"><span>ou rejoindre une room</span></div>
        <div className="join-row">
          <input value={roomId} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} aria-label="Identifiant de room" />
          <button type="button" className="secondary-button" onClick={() => enterRoom(`/game/${roomId.trim()}`)} disabled={!name.trim() || roomId.trim().length < 4}>Rejoindre</button>
        </div>
      </section>
      <p className="status-note"><span className="status-dot" /> Les parties sont stockées temporairement en mémoire.</p>
    </main>
  );
}
