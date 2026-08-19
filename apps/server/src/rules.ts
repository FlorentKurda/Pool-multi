import type { BallState, GameStatus } from "@pool/game-core";

export type PlayerGroup = "solid" | "stripe";

export type RulesState = {
  groups: Record<string, PlayerGroup | null>;
  winnerId: string | null;
  status: GameStatus;
  currentPlayerId: string | null;
};

export type ShotResolution = {
  state: RulesState;
  continueTurn: boolean;
  respawnCueBall: boolean;
};

export function resolveShot(
  state: RulesState,
  playerId: string,
  opponentId: string | null,
  ballsBefore: BallState[],
  pocketedBallIds: number[],
): ShotResolution {
  const pocketed = new Set(pocketedBallIds);
  const pocketedBalls = ballsBefore.filter((ball) => pocketed.has(ball.id));
  const cuePocketed = pocketed.has(0);
  const eightPocketed = pocketed.has(8);
  const nextGroups = { ...state.groups };
  const playerGroup = nextGroups[playerId] ?? null;
  const firstScoredBall = pocketedBalls.find((ball) => ball.group === "solid" || ball.group === "stripe");
  const firstScoredGroup: PlayerGroup | undefined = firstScoredBall?.group === "solid" || firstScoredBall?.group === "stripe" ? firstScoredBall.group : undefined;

  if (!playerGroup && !cuePocketed && firstScoredGroup) {
    nextGroups[playerId] = firstScoredGroup;
    if (opponentId) nextGroups[opponentId] = firstScoredGroup === "solid" ? "stripe" : "solid";
  }

  const assignedGroup = nextGroups[playerId] ?? null;
  const scoredOwnBall = pocketedBalls.some((ball) => ball.group === assignedGroup);
  const remainingOwnBalls = assignedGroup
    ? ballsBefore.filter((ball) => !ball.pocketed && ball.group === assignedGroup).length
    : 0;
  const legalEight = eightPocketed && Boolean(assignedGroup) && remainingOwnBalls === 0 && !cuePocketed;

  if (eightPocketed) {
    return {
      state: { groups: nextGroups, winnerId: legalEight ? playerId : opponentId, status: "finished", currentPlayerId: null },
      continueTurn: false,
      respawnCueBall: false,
    };
  }

  const nextPlayerId = cuePocketed ? opponentId : scoredOwnBall ? playerId : opponentId;
  return {
    state: { groups: nextGroups, winnerId: null, status: state.status, currentPlayerId: nextPlayerId },
    continueTurn: nextPlayerId === playerId,
    respawnCueBall: cuePocketed,
  };
}
