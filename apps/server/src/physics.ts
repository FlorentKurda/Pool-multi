import Matter, { type Body as MatterBody, type Engine as MatterEngine, type IEventCollision } from "matter-js";
import { createRack, TABLE, type BallState } from "@pool/game-core";

const { Bodies, Body, Composite, Engine, Events, World } = Matter;

const FIXED_DELTA_MS = 1000 / 60;
const POCKET_RADIUS = 29;
const STOP_SPEED = 0.08;
const BALL_FRICTION_AIR = 0.012;
const BALL_RESTITUTION = 0.92;
const BALL_FRICTION = 0.005;
const MAX_POWER = 14;

type PhysicsBall = {
  state: BallState;
  body: MatterBody;
};

export type PhysicsEvent =
  | { type: "ball-collision"; ballId: number; otherBallId: number }
  | { type: "cushion-collision"; ballId: number }
  | { type: "ball-pocketed"; ballId: number };

const pocketPositions: ReadonlyArray<readonly [number, number]> = [
  [42, 42],
  [TABLE.width / 2, 36],
  [TABLE.width - 42, 42],
  [42, TABLE.height - 42],
  [TABLE.width / 2, TABLE.height - 36],
  [TABLE.width - 42, TABLE.height - 42],
];

function createCushions() {
  const wallOptions = { isStatic: true, restitution: 0.86, friction: 0.01, label: "cushion" };
  const horizontalSegments = [
    [TABLE.cushion + 36, TABLE.width / 2 - 55],
    [TABLE.width / 2 + 55, TABLE.width - TABLE.cushion - 36],
  ] as const;
  const verticalSegments = [
    [TABLE.cushion + 36, TABLE.height / 2 - 55],
    [TABLE.height / 2 + 55, TABLE.height - TABLE.cushion - 36],
  ] as const;
  const thickness = 20;
  const cushions: MatterBody[] = [];

  for (const [start, end] of horizontalSegments) {
    const centerX = (start + end) / 2;
    cushions.push(Bodies.rectangle(centerX, TABLE.cushion, end - start, thickness, wallOptions));
    cushions.push(Bodies.rectangle(centerX, TABLE.height - TABLE.cushion, end - start, thickness, wallOptions));
  }
  for (const [start, end] of verticalSegments) {
    const centerY = (start + end) / 2;
    cushions.push(Bodies.rectangle(TABLE.cushion, centerY, thickness, end - start, wallOptions));
    cushions.push(Bodies.rectangle(TABLE.width - TABLE.cushion, centerY, thickness, end - start, wallOptions));
  }
  return cushions;
}

export class PoolPhysics {
  readonly engine: MatterEngine;
  private readonly balls = new Map<number, PhysicsBall>();
  private readonly events: PhysicsEvent[] = [];

  constructor() {
    this.engine = Engine.create({ enableSleeping: false, gravity: { x: 0, y: 0, scale: 0 } });
    this.engine.timing.timeScale = 1;
    World.add(this.engine.world, createCushions());
    this.reset();
    Events.on(this.engine, "collisionStart", (event) => this.handleCollisions(event as IEventCollision<MatterEngine>));
  }

  reset(): void {
    for (const ball of this.balls.values()) {
      Composite.remove(this.engine.world, ball.body, true);
    }
    this.balls.clear();
    for (const state of createRack()) {
      const body = this.createBallBody(state);
      this.balls.set(state.id, { state: { ...state }, body });
      World.add(this.engine.world, body);
    }
  }

  respawnCueBall(x = 270, y = TABLE.height / 2): void {
    const cue = this.balls.get(0);
    if (!cue || !cue.state.pocketed) return;
    const state: BallState = { ...cue.state, x, y, pocketed: false };
    const body = this.createBallBody(state);
    this.balls.set(0, { state, body });
    World.add(this.engine.world, body);
  }

  shoot(angle: number, power: number): boolean {
    if (!Number.isFinite(angle) || !Number.isFinite(power) || power <= 0) return false;
    const cue = this.balls.get(0);
    if (!cue || cue.state.pocketed || this.isMoving()) return false;
    const clampedPower = Math.min(power, MAX_POWER);
    Body.setVelocity(cue.body, { x: Math.cos(angle) * clampedPower, y: Math.sin(angle) * clampedPower });
    return true;
  }

  step(deltaMs = FIXED_DELTA_MS): void {
    Engine.update(this.engine, deltaMs);
    for (const ball of this.balls.values()) {
      if (!ball.state.pocketed && this.isInPocket(ball.body.position.x, ball.body.position.y)) {
        ball.state.pocketed = true;
        Body.setVelocity(ball.body, { x: 0, y: 0 });
        Composite.remove(this.engine.world, ball.body, true);
        this.events.push({ type: "ball-pocketed", ballId: ball.state.id });
      }
      if (this.isStopped(ball.body)) Body.setVelocity(ball.body, { x: 0, y: 0 });
    }
  }

  isMoving(): boolean {
    return [...this.balls.values()].some(({ body, state }) => !state.pocketed && !this.isStopped(body));
  }

  snapshot(): BallState[] {
    return [...this.balls.values()].map(({ state, body }) => ({
      ...state,
      x: body.position.x,
      y: body.position.y,
    }));
  }

  drainEvents(): PhysicsEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private isStopped(body: MatterBody): boolean {
    return body.speed < STOP_SPEED;
  }

  private isInPocket(x: number, y: number): boolean {
    return pocketPositions.some(([pocketX, pocketY]) => Math.hypot(x - pocketX, y - pocketY) <= POCKET_RADIUS);
  }

  private handleCollisions(event: IEventCollision<MatterEngine>): void {
    for (const pair of event.pairs) {
      const first = this.ballIdFromBody(pair.bodyA);
      const second = this.ballIdFromBody(pair.bodyB);
      if (first !== null && second !== null) {
        this.events.push({ type: "ball-collision", ballId: first, otherBallId: second });
      } else if (first !== null || second !== null) {
        this.events.push({ type: "cushion-collision", ballId: first ?? second ?? -1 });
      }
    }
  }

  private ballIdFromBody(body: MatterBody): number | null {
    if (!body.label.startsWith("ball:")) return null;
    const id = Number(body.label.slice("ball:".length));
    return Number.isInteger(id) ? id : null;
  }

  private createBallBody(state: BallState): MatterBody {
    return Bodies.circle(state.x, state.y, TABLE.ballRadius, {
      restitution: BALL_RESTITUTION,
      friction: BALL_FRICTION,
      frictionAir: BALL_FRICTION_AIR,
      inertia: Infinity,
      label: `ball:${state.id}`,
    });
  }
}

export { FIXED_DELTA_MS };
