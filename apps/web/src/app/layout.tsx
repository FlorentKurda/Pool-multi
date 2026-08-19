import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Pool Multiplayer",
  description: "Un jeu de billard américain 8-ball multijoueur.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
