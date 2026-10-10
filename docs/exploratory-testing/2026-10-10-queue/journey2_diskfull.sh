#!/usr/bin/env bash
# Journey 2: persistence when the PERSIST volume runs out of space, then recovers.
# Usage: journey2_diskfull.sh <binary> <mounted-small-volume> <port> <kill-signal>
# Needs a small, empty, writable volume (e.g. a macOS RAM disk, see report).
set -u
BIN=$1; VOL=$2; PORT=$3; SIG=${4:-KILL}
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
enq() { # enq <queue> <payload-json>
  printf '%s' "{\"payload\":$2}" | curl -s -o /dev/null -w "enqueue $1 -> %{http_code}\n" \
    -X POST -H "$AUTH" -H 'Content-Type: application/json' --data-binary @- "$B/enqueue/$1"
}
len() { echo "length $1 -> $(curl -s -H "$AUTH" "$B/length/$1")"; }

start
enq q '"before-full"'
# Fill the volume, leaving a small amount of free space.
dd if=/dev/zero of="$VOL/filler" bs=1024 count=100000 2>/dev/null
FREE=$(df -k "$VOL" | awk 'NR==2{print $4}'); echo "free KiB after filler: $FREE"
# Payload bigger than the remaining space (~200 KB string).
BIG="\"$(head -c 200000 /dev/zero | tr '\0' 'A')\""
enq q "$BIG"
len q
echo "persist.dat bytes: $(wc -c <"$DIR/persist.dat")"
rm -f "$VOL/filler"; echo "filler removed; free KiB: $(df -k "$VOL" | awk 'NR==2{print $4}')"
enq q '"after-space-freed"'
len q
echo "persist.dat lines: $(wc -l <"$DIR/persist.dat")  bytes: $(wc -c <"$DIR/persist.dat")"
echo "last 120 bytes of persist.dat:"; tail -c 120 "$DIR/persist.dat"; echo
echo "--- stopping server with SIG$SIG"
kill -s "$SIG" $PID; wait $PID 2>/dev/null
start
echo "--- after restart"
len q
for _ in 1 2 3 4; do
  curl -s -H "$AUTH" -o "$VOL/out" -w "dequeue q -> %{http_code} " "$B/dequeue/q"; head -c 40 "$VOL/out"; echo
done
kill -TERM $PID; wait $PID 2>/dev/null
