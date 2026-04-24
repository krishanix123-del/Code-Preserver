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

Room-based video/screen-share/chat app under `artifacts/nexuscast` (web), `artifacts/nexuscast-mobile` (Expo WebView shell), with signaling backend at `artifacts/api-server`.

### Media architecture: LiveKit SFU

Media (camera, screen share, mic) goes through a LiveKit Cloud SFU instead of a custom WebRTC mesh. This eliminates the N×N peer connection load and gives reliable mobile screen-share with simulcast + adaptive stream.

- **Server creds (Replit Secrets)**: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- **Token endpoint**: `GET /api/livekit/config` and `GET /api/livekit/token?room=...&identity=...&name=...` — mints a 6h `roomJoin` token with publish + subscribe.
- **Backend route**: `artifacts/api-server/src/routes/livekit.ts` (uses `livekit-server-sdk`)
- **Frontend hook**: `artifacts/nexuscast/src/lib/livekit.ts` — `useLiveKit()` exposes `connect/disconnect/setCamera/setScreen/setMic`, `localCameraStream`, `localScreenStream`, `remoteVideos[{identity, source, stream}]`, `isCameraOn/isScreenOn/isMicOn`. Configured with adaptiveStream + dynacast + simulcast (h180/h360/h720 VP8) and screenShare h720fps15 → h1080fps15.
- **Identity convention**: LiveKit `identity` = app `userId` (so remote tracks line up with `members[].userId` from the socket presence list).

### Signaling (socket.io, unchanged)

`artifacts/api-server/src/signaling.ts` still handles room presence, host transfer, kick, mute, chat, name-change, and join-stream-request flows over socket.io. The old `offer`/`answer`/`ice-candidate` socket forwarders were removed — LiveKit handles all WebRTC negotiation.
