#!/bin/bash

# Kill any leftover processes
fuser -k 8080/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true

# Start the API server on port 8080 in the background (no wait)
(cd artifacts/api-server && PORT=8080 pnpm run dev) &

# Start the Nexuscast frontend immediately on port 3000
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/nexuscast run dev
