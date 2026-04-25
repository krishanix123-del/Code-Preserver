# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## NexusCast App

- **Architecture**: Peer-to-peer WebRTC mesh (no SFU). Every browser opens an `RTCPeerConnection` to every other peer in the room. The Express + socket.io backend (`artifacts/api-server`) only relays signaling messages (`offer`, `answer`, `ice-candidate`) and room/chat events — it never carries media.
- **Frontend**: `artifacts/nexuscast` (React + Vite). All call logic lives in `src/App.tsx` (`pcsRef`, `localStreamRef`, `screenStreamRef`, `audioStreamRef`, `getOrCreatePC`, `connectToPeer`, `applyVideoEncodingParams`, `removePeer`).
- **Mobile shell**: `artifacts/nexuscast-mobile` (Expo WebView wrapping the web app). Cannot capture device screen — `getDisplayMedia` is unsupported in WebView.
- **Screen share**: Desktop only. Clicking the screen-share button opens a modal that asks **"Share with audio"** vs **"Share without audio"**. The chosen value is forwarded to `getDisplayMedia({ audio })` so a host can broadcast tab/system audio playing on screen. The captured screen audio replaces the mic track on every PC; on stop, the mic track is restored.
- **Workflows**: `Start Backend` (API on 8080) and `Start application` (web on 19783) are the canonical workflows. The auto-started `artifacts/*: ...` duplicates conflict on the same ports and should not run simultaneously.
- **Removed**: LiveKit (server SDK + client) was fully removed. Stale `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` secrets remain in the environment but are unused and can be deleted.
