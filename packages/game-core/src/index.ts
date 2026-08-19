export const TABLE = {
  width: 1200,
  height: 650,
  cushion: 42,
  ballRadius: 15,
} as const;

export type GameStatus = "waiting" | "playing" | "finished";
export type BallGroup = "solid" | "stripe" | "eight" | "cue";

export type Player = {
  id: string;
  name: string;
  connected: boolean;
};

export type BallState = {
  id: number;
  x: number;
  y: number;
  group: BallGroup;
  pocketed: boolean;
};

export type GameState = {
  roomId: string;
  status: GameStatus;
  players: Player[];
  currentPlayerId: string | null;
  balls: BallState[];
  groups: Record<string, "solid" | "stripe" | null>;
  winnerId: string | null;
};

export type RoomState = Pick<GameState, "roomId" | "status" | "players" | "currentPlayerId">;

export type CreateRoomPayload = { playerName: string };
export type JoinRoomPayload = { roomId: string; playerId: string; playerName: string };
export type ReconnectRoomPayload = { roomId: string; playerId: string };
export type RematchPayload = { roomId: string; playerId: string };
export type PhysicsShootPayload = { angle: number; power: number };

export type ClientToServerEvents = {
  "room:create": (payload: CreateRoomPayload & { playerId: string }) => void;
  "room:join": (payload: JoinRoomPayload) => void;
  "room:reconnect": (payload: ReconnectRoomPayload) => void;
  "physics:shoot": (payload: PhysicsShootPayload) => void;
  "game:rematch": (payload: RematchPayload) => void;
};

export type ServerToClientEvents = {
  "room:state": (state: RoomState) => void;
  "game:state": (state: GameState) => void;
  "game:snapshot": (snapshot: { roomId: string; balls: BallState[]; moving: boolean; events: Array<{ type: string; ballId: number; otherBallId?: number }> }) => void;
  "game:error": (error: { code: string; message: string }) => void;
};

export function createRack(): BallState[] {
  const balls: BallState[] = [{ id: 0, x: 270, y: TABLE.height / 2, group: "cue", pocketed: false }];
  const startX = 900;
  const startY = TABLE.height / 2;
  let number = 1;

  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      const group: BallGroup = number === 8 ? "eight" : number < 8 ? "solid" : "stripe";
      balls.push({
        id: number,
        x: startX + row * TABLE.ballRadius * 1.75,
        y: startY + (column - row / 2) * TABLE.ballRadius * 2.15,
        group,
        pocketed: false,
      });
      number += 1;
    }
  }

  return balls;
}
