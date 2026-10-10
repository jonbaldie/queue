#!/usr/bin/env bash
# Journey 2 variation: enqueue/dequeue when the PERSIST volume is already completely full.
# Usage: journey2_enospc_500.sh <binary> <mounted-small-volume> <port>
# The server log is kept off the small volume so log writes cannot fail.
set -u
BIN=$1; VOL=$2; PORT=$3
TOKEN=qx-token-20261010
DIR="$VOL/data"
B="http://127.0.0.1:$PORT"
LOG="${TMPDIR:-/tmp}/qx20261010-enospc-server.log"
AUTH="Authorization: Bearer $TOKEN"
rm -rf "$DIR" "$VOL/filler"; mkdir -p "$DIR"
QUEUE_API_TOKEN=$TOKEN PORT=$PORT PERSIST="$DIR/" "$BIN" --persist >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 50); do curl -sf "$B/health" >/dev/null && break; sleep 0.1; done
enq() {
  printf '%s' "{\"payload\":$2}" | curl -s -o /dev/null -w "enqueue $1 $2 -> %{http_code}\n" \
    -X POST -H "$AUTH" -H 'Content-Type: application/json' --data-binary @- "$B/enqueue/$1"
}
enq q '"first"'
dd if=/dev/zero of="$VOL/filler" bs=1024 count=100000 2>/dev/null
echo "free KiB: $(df -k "$VOL" | awk 'NR==2{print $4}')"
# Use up any tail of the last block so the next write fails outright.
for i in 1 2 3; do enq q "\"pad-$i-$(head -c 8000 /dev/zero | tr '\0' 'p')\"" ; done
enq q '"during-full"'
echo "length q -> $(curl -s -H "$AUTH" "$B/length/q")"
for _ in 1 2; do
  curl -s -H "$AUTH" -o "$LOG.out" -w "dequeue q -> %{http_code} " "$B/dequeue/q"; head -c 30 "$LOG.out"; echo
  echo "length q -> $(curl -s -H "$AUTH" "$B/length/q")"
done
rm -f "$VOL/filler"; echo "filler removed (space available again)"
for _ in 1 2 3 4 5; do
  curl -s -H "$AUTH" -o "$LOG.out" -w "dequeue q -> %{http_code} " "$B/dequeue/q"; head -c 30 "$LOG.out"; echo
done
echo "server log (no stack frames):"; grep -v "^    at" "$LOG" | grep -E "^(GET|POST|Error)" | cut -c1-80
kill -TERM $PID; wait $PID 2>/dev/null
