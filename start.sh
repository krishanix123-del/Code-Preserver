#!/bin/bash
set -e

# Kill any processes on our ports
fuser -k 8080/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true

# Build and start the API server in background
export NODE_ENV=development
(cd artifacts/api-server && PORT=8080 pnpm run dev) &
API_PID=$!

# Wait for port 8080 to be open
echo "Waiting for API server on port 8080..."
for i in $(seq 1 30); do
  if nc -z localhost 8080 2>/dev/null; then
    echo "API server ready!"
    break
  fi
  sleep 1
done

# Start the frontend
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/nexuscast run dev &
VITE_PID=$!

# Wait for both processes
wait $VITE_PID
kill $API_PID 2>/dev/null || true
