import { GameClient } from "./game-client";

export default async function GamePage({ params }: { params: Promise<{ roomId: string }> }) {
  const resolvedParams = await params;
  return <GameClient roomId={resolvedParams.roomId.toUpperCase()} />;
}
