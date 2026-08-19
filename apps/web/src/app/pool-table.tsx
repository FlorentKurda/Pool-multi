"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { createRack, TABLE, type BallState, type ClientToServerEvents, type ServerToClientEvents } from "@pool/game-core";

const MAX_POWER = 14;
const MAX_DRAG_DISTANCE = 150;

const palette: Record<BallState["group"], string> = {
  cue: "#f8f5ed",
  solid: "#e86d45",
  stripe: "#3d83b9",
  eight: "#171a20",
};

type AimState = { angle: number; power: number; pointerX: number; pointerY: number };

function drawTable(canvas: HTMLCanvasElement, balls: BallState[], aim: AimState | null, canShoot: boolean) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const scale = canvas.width / TABLE.width;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, TABLE.width, TABLE.height);

  context.fillStyle = "#17483e";
  context.fillRect(0, 0, TABLE.width, TABLE.height);
  context.strokeStyle = "#b7864b";
  context.lineWidth = 18;
  context.strokeRect(18, 18, TABLE.width - 36, TABLE.height - 36);
  context.strokeStyle = "#d4a264";
  context.lineWidth = 5;
  context.strokeRect(32, 32, TABLE.width - 64, TABLE.height - 64);

  const pockets: Array<[number, number]> = [[42, 42], [TABLE.width / 2, 36], [TABLE.width - 42, 42], [42, TABLE.height - 42], [TABLE.width / 2, TABLE.height - 36], [TABLE.width - 42, TABLE.height - 42]];
  for (const [x, y] of pockets) {
    context.beginPath();
    context.fillStyle = "#10151a";
    context.arc(x, y, 27, 0, Math.PI * 2);
    context.fill();
  }

  const cue = balls.find((ball) => ball.id === 0 && !ball.pocketed);
  if (cue && aim && canShoot) {
    const lineLength = 80 + aim.power * 100;
    context.save();
    context.setLineDash([10, 8]);
    context.strokeStyle = "rgba(248,245,237,.8)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(cue.x, cue.y);
    context.lineTo(cue.x + Math.cos(aim.angle) * lineLength, cue.y + Math.sin(aim.angle) * lineLength);
    context.stroke();
    context.restore();
  }

  for (const ball of balls) {
    if (ball.pocketed) continue;
    context.beginPath();
    context.fillStyle = palette[ball.group];
    context.arc(ball.x, ball.y, TABLE.ballRadius, 0, Math.PI * 2);
    context.fill();
    if (ball.group === "stripe") {
      context.fillStyle = "#f5f0e6";
      context.fillRect(ball.x - TABLE.ballRadius, ball.y - 5, TABLE.ballRadius * 2, 10);
    }
    context.strokeStyle = "rgba(255,255,255,.35)";
    context.lineWidth = 1.5;
    context.stroke();
    if (ball.group !== "cue") {
      context.fillStyle = ball.group === "eight" ? "#fff" : "#16212b";
      context.font = "bold 10px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(ball.id), ball.x, ball.y);
    }
  }

  if (aim && canShoot) {
    context.fillStyle = "rgba(10, 24, 20, .72)";
    context.fillRect(55, TABLE.height - 58, 220, 16);
    context.fillStyle = "#ed7650";
    context.fillRect(55, TABLE.height - 58, 220 * aim.power, 16);
  }
}

type PoolTableProps = {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  connected: boolean;
  canShoot: boolean;
  moving: boolean;
  balls: BallState[];
};

export function PoolTable({ socket, connected, canShoot, moving, balls }: PoolTableProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderedBallsRef = useRef<BallState[]>(createRack());
  const targetBallsRef = useRef<BallState[]>(createRack());
  const aimingRef = useRef(false);
  const aimRef = useRef<AimState | null>(null);
  const [aim, setAim] = useState<AimState | null>(null);

  useEffect(() => {
    targetBallsRef.current = balls;
  }, [balls]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rendered = renderedBallsRef.current;
      const targets = targetBallsRef.current;
      renderedBallsRef.current = targets.map((target) => {
        const current = rendered.find((ball) => ball.id === target.id) ?? target;
        return { ...target, x: current.x + (target.x - current.x) * 0.24, y: current.y + (target.y - current.y) * 0.24 };
      });
      drawTable(canvas, renderedBallsRef.current, aimRef.current, canShoot);
      animationFrame = requestAnimationFrame(draw);
    };
    let animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [canShoot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const width = canvas.clientWidth;
      canvas.width = width;
      canvas.height = width * TABLE.height / TABLE.width;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  const getTablePoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * TABLE.width / bounds.width, y: (event.clientY - bounds.top) * TABLE.height / bounds.height };
  };

  const updateAim = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!aimingRef.current || !canShoot) return;
    const cue = renderedBallsRef.current.find((ball) => ball.id === 0 && !ball.pocketed);
    if (!cue) return;
    const point = getTablePoint(event);
    const dx = point.x - cue.x;
    const dy = point.y - cue.y;
    const distance = Math.hypot(dx, dy);
    const nextAim = { angle: Math.atan2(dy, dx), power: Math.min(distance / MAX_DRAG_DISTANCE, 1), pointerX: point.x, pointerY: point.y };
    aimRef.current = nextAim;
    setAim(nextAim);
  };

  const startAim = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canShoot) return;
    aimingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateAim(event);
  };

  const releaseAim = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!aimingRef.current) return;
    aimingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const nextAim = aimRef.current;
    if (nextAim && nextAim.power > 0.04) {
      socket.emit("physics:shoot", { angle: nextAim.angle, power: nextAim.power * MAX_POWER });
    }
    aimRef.current = null;
    setAim(null);
  };

  return (
    <div className="table-stage">
      <canvas ref={canvasRef} className="pool-canvas" role="img" aria-label="Table de billard interactive" onPointerDown={startAim} onPointerMove={updateAim} onPointerUp={releaseAim} onPointerCancel={releaseAim} />
      <div className="table-hud">
        <span className={connected ? "connection connected" : "connection"}>{connected ? "Serveur connecté" : "Connexion…"}</span>
        <span>{moving ? "Les boules roulent" : aim ? `Puissance ${Math.round(aim.power * 100)} %` : "Maintenez et faites glisser pour viser"}</span>
      </div>
    </div>
  );
}
