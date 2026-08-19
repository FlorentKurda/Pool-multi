# Pool Multiplayer

Monorepo pnpm pour un jeu de billard américain 8-ball multijoueur.

## Phases 1 à 6

- `apps/web` : interface Next.js/React, lobby, rooms, reconnexion et rendu Canvas 2D.
- `apps/server` : serveur Node.js + Socket.IO authoritative.
- `apps/server/src/physics.ts` : simulation Matter.js à timestep fixe de 60 Hz.
- `apps/server/src/room-manager.ts` : rooms mémoire, deux joueurs, reconnexion et revanche.
- `apps/server/src/rules.ts` : attribution des groupes et règles simplifiées du 8-ball.
- `packages/game-core` : constantes, types et contrats réseau partagés.

La table utilise un système de coordonnées fixe de `1200 × 650`, redimensionné uniquement pour l'affichage. La physique reste exclusivement côté serveur. Chaque room possède son propre moteur Matter.js et son propre joueur actif.

La Phase 6 conserve l'identifiant joueur dans `localStorage`, garde une place déconnectée pendant 60 secondes, affiche les états de connexion et propose une revanche après une partie terminée. Les rooms restent en mémoire et disparaissent lorsque leur dernier joueur est supprimé.

Les règles officielles complexes, la bille en main complète et les effets restent volontairement hors périmètre du MVP.

## Installation et lancement

Pré-requis : Node.js 20+ et pnpm 9+.

```bash
pnpm install
pnpm dev
```

- Frontend : http://localhost:3000
- Serveur Socket.IO : http://localhost:3001

Parcours disponible :

1. Ouvrir `/`.
2. Saisir un pseudo et créer une partie.
3. Partager l'URL `/game/ABC123`.
4. Le second joueur saisit son pseudo et ouvre le lien.

## Vérifications

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Les tests serveur couvrent la physique, les rooms, les règles du 8-ball, la reconnexion et la revanche.
