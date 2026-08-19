import { describe, expect, it } from "vitest";
import { createRack, type BallState } from "@pool/game-core";
import { resolveShot, type RulesState } from "./rules.js";

const initialState = (): RulesState => ({ groups: { alice: null, bob: null }, winnerId: null, status: "playing", currentPlayerId: "alice" });

function ballsWithPocketed(ids: number[]): BallState[] {
  const pocketed = new Set(ids);
  return createRack().map((ball) => ({ ...ball, pocketed: pocketed.has(ball.id) }));
}

describe("simplified eight-ball rules", () => {
  it("attribue les pleines et rayées au premier groupe empoché", () => {
    const result = resolveShot(initialState(), "alice", "bob", createRack(), [3]);

    expect(result.state.groups).toEqual({ alice: "solid", bob: "stripe" });
    expect(result.continueTurn).toBe(true);
  });

  it("passe la main si le joueur n'empoche pas son groupe", () => {
    const state: RulesState = { ...initialState(), groups: { alice: "solid", bob: "stripe" } };
    const result = resolveShot(state, "alice", "bob", createRack(), [9]);

    expect(result.state.currentPlayerId).toBe("bob");
    expect(result.continueTurn).toBe(false);
  });

  it("replace la blanche et donne la main à l'adversaire après une faute", () => {
    const state: RulesState = { ...initialState(), groups: { alice: "solid", bob: "stripe" } };
    const result = resolveShot(state, "alice", "bob", createRack(), [0]);

    expect(result.respawnCueBall).toBe(true);
    expect(result.state.currentPlayerId).toBe("bob");
  });

  it("déclare perdant un joueur qui empoche la 8 trop tôt", () => {
    const state: RulesState = { ...initialState(), groups: { alice: "solid", bob: "stripe" } };
    const result = resolveShot(state, "alice", "bob", createRack(), [8]);

    expect(result.state.status).toBe("finished");
    expect(result.state.winnerId).toBe("bob");
  });

  it("déclare gagnant le joueur qui empoche légalement la 8", () => {
    const before = ballsWithPocketed([1, 2, 3, 4, 5, 6, 7]);
    const state: RulesState = { ...initialState(), groups: { alice: "solid", bob: "stripe" } };
    const result = resolveShot(state, "alice", "bob", before, [8]);

    expect(result.state.status).toBe("finished");
    expect(result.state.winnerId).toBe("alice");
  });
});
