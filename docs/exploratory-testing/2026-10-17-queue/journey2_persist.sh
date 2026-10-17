#!/bin/sh
# Journey 2: acknowledged jobs survive a restart when --persist is on.
set -eu
EVID=docs/exploratory-testing/2026-10-17-queue
DATA="$EVID/persist-data"
TOKEN=explore-token-2026-10-17
PORT=18772
BASE=http://127.0.0.1:$PORT
BIN=./target/queue
TRANSCRIPT="$EVID/journey2-transcript.txt"
: > "$TRANSCRIPT"

log() {
  printf '%s\n' "$1" | tee -a "$TRANSCRIPT"
}

stop_server() {
  if [ -f "$EVID/journey2-server.pid" ]; then
    pid=$(cat "$EVID/journey2-server.pid")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$1" "$pid" 2>/dev/null || true
      i=0
      while kill -0 "$pid" 2>/dev/null; do
        i=$((i + 1))
        if [ "$i" -gt 50 ]; then
          log "server $pid did not exit after signal $1"
          break
        fi
        sleep 0.1
      done
    fi
    rm -f "$EVID/journey2-server.pid"
  fi
}

start_server() {
  label=$1
  QUEUE_API_TOKEN=$TOKEN HOST=127.0.0.1 PORT=$PORT PERSIST="$DATA" \
    "$BIN" --persist > "$EVID/journey2-server-$label.log" 2>&1 &
  echo $! > "$EVID/journey2-server.pid"
  i=0
  while ! grep -q "Listening" "$EVID/journey2-server-$label.log" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 30 ]; then
      log "FAIL start $label"
      cat "$EVID/journey2-server-$label.log" | tee -a "$TRANSCRIPT"
      exit 1
    fi
    sleep 0.1
  done
  log "started $label pid=$(cat "$EVID/journey2-server.pid")"
  cat "$EVID/journey2-server-$label.log" | tee -a "$TRANSCRIPT"
}

api() {
  method=$1
  path=$2
  body=${3-}
  if [ -n "$body" ]; then
    curl -sS -D - -o "$EVID/curl-body.txt" -X "$method" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary "$body" \
      "$BASE$path" | tee -a "$TRANSCRIPT"
  else
    curl -sS -D - -o "$EVID/curl-body.txt" -X "$method" \
      -H "Authorization: Bearer $TOKEN" \
      "$BASE$path" | tee -a "$TRANSCRIPT"
  fi
  printf 'BODY %s\n' "$(cat "$EVID/curl-body.txt")" | tee -a "$TRANSCRIPT"
}

rm -rf "$DATA"
mkdir -p "$DATA"
log "=== ordinary: enqueue, consume one, graceful stop, restart ==="
start_server graceful-1
api POST /enqueue/email '{"payload":{"id":"email-1","to":"ada@example.com"}}'
api POST /enqueue/email '{"payload":{"id":"email-2","to":"grace@example.com"}}'
api POST /enqueue/billing '{"payload":false}'
api POST /enqueue/billing '{"payload":0}'
api POST /enqueue/billing '{"payload":""}'
api POST /enqueue/notes '{"payload":"こんにちは"}'
api GET /dequeue/email
api GET /length/email
api GET /queues
log "--- persist.dat before stop ---"
wc -c "$DATA/persist.dat" | tee -a "$TRANSCRIPT"
stop_server -TERM
log "exit after SIGTERM, persist bytes=$(wc -c < "$DATA/persist.dat")"
log "--- server log tail ---"
tail -20 "$EVID/journey2-server-graceful-1.log" | tee -a "$TRANSCRIPT"

start_server graceful-2
api GET /queues
api GET /length/email
api GET /dequeue/email
api GET /dequeue/email
api GET /length/billing
api GET /dequeue/billing
api GET /dequeue/billing
api GET /dequeue/billing
api GET /dequeue/billing
api GET /dequeue/notes
api GET /dequeue/notes
api GET /queues
stop_server -TERM

log "=== variation: SIGKILL after acknowledged enqueue and dequeue ==="
rm -rf "$DATA"
mkdir -p "$DATA"
start_server kill-1
api POST /enqueue/jobs '{"payload":{"n":1}}'
api POST /enqueue/jobs '{"payload":{"n":2}}'
api POST /enqueue/jobs '{"payload":{"n":3}}'
api GET /dequeue/jobs
log "killing -9"
kill -9 "$(cat "$EVID/journey2-server.pid")"
sleep 0.3
rm -f "$EVID/journey2-server.pid"
log "persist bytes after kill=$(wc -c < "$DATA/persist.dat")"
log "--- persist.dat ---"
cat "$DATA/persist.dat" | tee -a "$TRANSCRIPT"
start_server kill-2
api GET /length/jobs
api GET /dequeue/jobs
api GET /dequeue/jobs
api GET /dequeue/jobs
api GET /queues
stop_server -TERM
log "DONE"
