#!/usr/bin/env bash
# Usage:
#   ./start.sh           — start server + orchestrator
#   ./start.sh --fresh   — wipe DB first, then start

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [[ "$1" == "--fresh" ]]; then
  echo "Wiping database..."
  rm -f "$ROOT/server/game.db"
fi

echo "Starting server..."
cd "$ROOT/server"
node server.js &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to be ready
echo "Waiting for server..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/api/world-info > /dev/null 2>&1; then
    echo "Server ready."
    break
  fi
  sleep 1
done

echo "Starting orchestrator..."
cd "$ROOT/bots"
node orchestrate.js &
ORC_PID=$!
echo "Orchestrator PID: $ORC_PID"

echo ""
echo "Both running. Press Ctrl+C to stop everything."

trap "echo 'Stopping...'; kill $SERVER_PID $ORC_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
