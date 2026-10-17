#!/bin/sh
# Variations on stopping and reopening a persisted queue.
set -eu
EVID=docs/exploratory-testing/2026-10-17-queue
TOKEN=explore-token-2026-10-17
BIN=./target/queue
OUT="$EVID/journey2-variations.txt"
: > "$OUT"
log() { printf '%s\n' "$1" | tee -a "$OUT"; }

# --- double SIGINT while a client holds a connection open ---
DATA="$EVID/persist-double"
rm -rf "$DATA"
mkdir -p "$DATA"
QUEUE_API_TOKEN=$TOKEN HOST=127.0.0.1 PORT=18773 PERSIST="$DATA" \
  "$BIN" --persist > "$EVID/double-server.log" 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  grep -q Listening "$EVID/double-server.log" && break
  sleep 0.1
done
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{"payload":{"id":"must-survive"}}' http://127.0.0.1:18773/enqueue/jobs >/dev/null
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{"payload":{"id":"second"}}' http://127.0.0.1:18773/enqueue/jobs >/dev/null
log "double-signal before bytes=$(wc -c < "$DATA/persist.dat")"
# Hold an incomplete request so shutdown has something to wait on.
python3 - <<'PY' &
import socket, time
s = socket.create_connection(("127.0.0.1", 18773))
s.sendall(b"POST /enqueue/jobs HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer explore-token-2026-10-17\r\nContent-Type: application/json\r\nContent-Length: 80\r\n\r\n{\"payload\":")
time.sleep(5)
s.close()
PY
HOLD=$!
sleep 0.2
kill -INT "$PID" || true
kill -INT "$PID" || true
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    log "double-signal server still alive, sending TERM"
    kill -TERM "$PID" || true
    break
  fi
  sleep 0.1
done
wait "$HOLD" 2>/dev/null || true
log "double-signal after bytes=$(wc -c < "$DATA/persist.dat" 2>/dev/null || echo missing)"
log "--- persist.dat ---"
cat "$DATA/persist.dat" 2>/dev/null | tee -a "$OUT" || log "no persist.dat"
log "--- server log ---"
cat "$EVID/double-server.log" | tee -a "$OUT"
# reopen
QUEUE_API_TOKEN=$TOKEN HOST=127.0.0.1 PORT=18773 PERSIST="$DATA" \
  "$BIN" --persist > "$EVID/double-restart.log" 2>&1 &
PID2=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  grep -q Listening "$EVID/double-restart.log" && break
  sleep 0.1
done
log "restart log:"
cat "$EVID/double-restart.log" | tee -a "$OUT"
log "length=$(curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18773/length/jobs)"
log "item1=$(curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18773/dequeue/jobs)"
log "item2=$(curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18773/dequeue/jobs)"
log "item3=$(curl -sS -w ' status:%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18773/dequeue/jobs)"
kill -TERM "$PID2" 2>/dev/null || true
wait "$PID2" 2>/dev/null || true

# --- second process, same persist directory, different port ---
DATA2="$EVID/persist-two"
rm -rf "$DATA2"
mkdir -p "$DATA2"
QUEUE_API_TOKEN=$TOKEN HOST=127.0.0.1 PORT=18774 PERSIST="$DATA2" \
  "$BIN" --persist > "$EVID/two-a.log" 2>&1 &
A=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  grep -q Listening "$EVID/two-a.log" && break
  sleep 0.1
done
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{"payload":"from-a"}' http://127.0.0.1:18774/enqueue/jobs >/dev/null
QUEUE_API_TOKEN=$TOKEN HOST=127.0.0.1 PORT=18775 PERSIST="$DATA2" \
  "$BIN" --persist > "$EVID/two-b.log" 2>&1 &
B=$!
sleep 1
log "=== two writers ==="
log "A alive=$(kill -0 "$A" 2>/dev/null && echo yes || echo no) B alive=$(kill -0 "$B" 2>/dev/null && echo yes || echo no)"
log "--- B log ---"
cat "$EVID/two-b.log" | tee -a "$OUT"
if grep -q Listening "$EVID/two-b.log"; then
  curl -sS -w '\nHTTP %{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data-binary '{"payload":"from-b"}' http://127.0.0.1:18775/enqueue/jobs | tee -a "$OUT"
  log "A length=$(curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18774/length/jobs)"
  log "B length=$(curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18775/length/jobs)"
  log "A dequeue=$(curl -sS -w ' status:%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18774/dequeue/jobs)"
  log "B dequeue=$(curl -sS -w ' status:%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18775/dequeue/jobs)"
fi
kill -TERM "$A" 2>/dev/null || true
kill -TERM "$B" 2>/dev/null || true
sleep 0.5
# if still alive, kill
kill -9 "$A" 2>/dev/null || true
kill -9 "$B" 2>/dev/null || true
wait "$A" 2>/dev/null || true
wait "$B" 2>/dev/null || true
log "--- persist after both stopped ---"
cat "$DATA2/persist.dat" 2>/dev/null | tee -a "$OUT" || log "missing persist"
QUEUE_API_TOKEN=$TOKEN HOST=127.0.0.1 PORT=18774 PERSIST="$DATA2" \
  "$BIN" --persist > "$EVID/two-restart.log" 2>&1 &
R=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  grep -q Listening "$EVID/two-restart.log" && break
  sleep 0.1
done
log "--- restart log ---"
cat "$EVID/two-restart.log" | tee -a "$OUT"
log "recovered length=$(curl -sS -m 2 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18774/length/jobs || echo fail)"
log "recovered1=$(curl -sS -m 2 -w ' status:%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18774/dequeue/jobs || echo fail)"
log "recovered2=$(curl -sS -m 2 -w ' status:%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18774/dequeue/jobs || echo fail)"
log "recovered3=$(curl -sS -m 2 -w ' status:%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18774/dequeue/jobs || echo fail)"
kill -TERM "$R" 2>/dev/null || true
wait "$R" 2>/dev/null || true
log "DONE variations"
