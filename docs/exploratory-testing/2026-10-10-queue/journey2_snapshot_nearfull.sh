#!/usr/bin/env bash
# Journey 2 variation: graceful shutdown snapshot when the PERSIST volume is nearly full.
# Usage: journey2_snapshot_nearfull.sh <binary> <mounted-small-volume> <port>
set -u
BIN=$1; VOL=$2; PORT=$3
TOKEN=qx-token-20261010
DIR="$VOL/data"
B="http://127.0.0.1:$PORT"
AUTH="Authorization: Bearer $TOKEN"
rm -rf "$DIR" "$VOL/filler"; mkdir -p "$DIR"

start() {
  QUEUE_API_TOKEN=$TOKEN PORT=$PORT PERSIST="$DIR/" "$BIN" --persist >>"$VOL/server.log" 2>&1 &
  PID=$!
  for _ in $(seq 50); do curl -sf "$B/health" >/dev/null && return; sleep 0.1; done
  echo "server did not start"; exit 1
}
enq() {
  printf '%s' "{\"payload\":$2}" | curl -s -o /dev/null -w "enqueue $1 -> %{http_code}\n" \
    -X POST -H "$AUTH" -H 'Content-Type: application/json' --data-binary @- "$B/enqueue/$1"
}

start
enq q '"small-1"'
BIG="\"$(head -c 200000 /dev/zero | tr '\0' 'B')\""
enq q "$BIG"
echo "length q -> $(curl -s -H "$AUTH" "$B/length/q")"
echo "persist.dat bytes before shutdown: $(wc -c <"$DIR/persist.dat")"
# Leave ~100 KiB free: enough for the small line, not for the 200 KB line.
FREE=$(df -k "$VOL" | awk 'NR==2{print $4}')
dd if=/dev/zero of="$VOL/filler" bs=1024 count=$((FREE - 100)) 2>/dev/null
echo "free KiB before shutdown: $(df -k "$VOL" | awk 'NR==2{print $4}')"
kill -TERM $PID; wait $PID; echo "server exit status: $?"
tail -3 "$VOL/server.log"
echo "persist.dat bytes after shutdown: $(wc -c <"$DIR/persist.dat")"
rm -f "$VOL/filler"
start
echo "--- after restart (space freed)"
echo "length q -> $(curl -s -H "$AUTH" "$B/length/q")"
for _ in 1 2 3; do
  curl -s -H "$AUTH" -o "$VOL/out" -w "dequeue q -> %{http_code} " "$B/dequeue/q"; head -c 30 "$VOL/out"; echo
done
kill -TERM $PID; wait $PID 2>/dev/null
