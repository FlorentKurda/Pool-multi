import { describe, expect, it } from "vitest";
import { PoolPhysics } from "./physics.js";

describe("PoolPhysics", () => {
  it("crée la table avec les 16 boules du rack", () => {
    const physics = new PoolPhysics();

    expect(physics.snapshot()).toHaveLength(16);
    expect(physics.snapshot().filter((ball) => ball.group === "cue")).toHaveLength(1);
  });

  it("déplace la boule blanche après une impulsion", () => {
    const physics = new PoolPhysics();
    const initialCue = physics.snapshot().find((ball) => ball.id === 0);
    expect(initialCue).toBeDefined();

    expect(physics.shoot(0, 8)).toBe(true);
    physics.step();

    const movedCue = physics.snapshot().find((ball) => ball.id === 0);
    expect(movedCue).toBeDefined();
    expect(movedCue?.x).toBeGreaterThan(initialCue?.x ?? 0);
  });

  it("refuse un second tir tant que les boules bougent", () => {
    const physics = new PoolPhysics();

    expect(physics.shoot(0, 8)).toBe(true);
    expect(physics.shoot(Math.PI, 8)).toBe(false);
  });
});
