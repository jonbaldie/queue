#!/usr/bin/env bash
# Journey 3: README Docker deployment with a named volume, container recreation,
# and a small tmpfs /data to check the disk-full path on Linux.
# Usage: journey3_docker.sh <image>
set -u
IMG=$1; TOKEN=qx-token-20261010; PORT=39401
NAME=qx20261010-c; VOL=qx20261010-data
B="http://127.0.0.1:$PORT"; AUTH="Authorization: Bearer $TOKEN"
wait_up() { for _ in $(seq 50); do curl -sf "$B/health" >/dev/null && return; sleep 0.2; done; echo "not up"; docker logs $NAME; }
enq() {
  printf '%s' "{\"payload\":$2}" | curl -s -o /dev/null -w "enqueue $1 -> %{http_code}\n" \
    -X POST -H "$AUTH" -H 'Content-Type: application/json' --data-binary @- "$B/enqueue/$1"
}
deq() { curl -s -H "$AUTH" -o /tmp/qx20261010-out -w "dequeue $1 -> %{http_code} " "$B/dequeue/$1"; head -c 30 /tmp/qx20261010-out; echo; }

echo "### 3a: named volume survives container recreation (README Persistency section)"
docker run -d --name $NAME -e QUEUE_API_TOKEN=$TOKEN -e PORT=1991 -e HOST=0.0.0.0 \
  -v $VOL:/data -p $PORT:1991 "$IMG" /usr/bin/queue --persist >/dev/null
wait_up
enq jobs '{"id":1}'; enq jobs '{"id":2}'; deq jobs
docker rm -f $NAME >/dev/null; echo "container force-removed (no graceful shutdown)"
docker run -d --name $NAME -e QUEUE_API_TOKEN=$TOKEN -e PORT=1991 -e HOST=0.0.0.0 \
  -v $VOL:/data -p $PORT:1991 "$IMG" /usr/bin/queue --persist >/dev/null
wait_up
echo "length jobs -> $(curl -s -H "$AUTH" "$B/length/jobs")"; deq jobs; deq jobs
docker stop $NAME >/dev/null; docker rm $NAME >/dev/null

echo "### 3b: README volume advice without --persist (default CMD)"
docker run -d --name $NAME -e QUEUE_API_TOKEN=$TOKEN -e PORT=1991 -e HOST=0.0.0.0 \
  -v $VOL:/data -p $PORT:1991 "$IMG" >/dev/null
wait_up
enq nopersist '"x"'
docker stop $NAME >/dev/null; docker start $NAME >/dev/null; wait_up
echo "length nopersist after restart -> $(curl -s -H "$AUTH" "$B/length/nopersist")"
docker rm -f $NAME >/dev/null

echo "### 3c: graceful stop with a nearly full 2 MiB tmpfs volume (Linux)"
TVOL=qx20261010-tmpfs
docker volume create --driver local --opt type=tmpfs --opt device=tmpfs --opt o=size=2m,uid=1993,gid=1993 $TVOL >/dev/null
# A sleeper keeps the tmpfs volume mounted so its contents outlive the queue container.
docker run -d --name ${NAME}-holder -v $TVOL:/data --entrypoint sleep "$IMG" 3600 >/dev/null
run_q() { docker run -d --name $NAME -e QUEUE_API_TOKEN=$TOKEN -e PORT=1991 -e HOST=0.0.0.0 \
  -v $TVOL:/data -p $PORT:1991 "$IMG" /usr/bin/queue --persist >/dev/null; wait_up; }
run_q
enq q '"small-1"'
BIG="\"$(head -c 200000 /dev/zero | tr '\0' 'B')\""
enq q "$BIG"
echo "length q -> $(curl -s -H "$AUTH" "$B/length/q")"
docker exec ${NAME}-holder sh -c 'free=$(df -k /data | awk "NR==2{print \$4}"); dd if=/dev/zero of=/data/filler bs=1024 count=$((free-100)) 2>/dev/null; echo "persist.dat bytes before stop: $(wc -c </data/persist.dat)"; df -k /data | tail -1'
docker stop $NAME >/dev/null
docker logs $NAME 2>&1 | tail -3
echo "queue container: $(docker inspect -f 'exit={{.State.ExitCode}}' $NAME)"
docker rm $NAME >/dev/null
docker exec ${NAME}-holder sh -c 'echo "persist.dat bytes after stop: $(wc -c </data/persist.dat)"; rm /data/filler'
run_q
echo "--- after restart (space freed)"
echo "length q -> $(curl -s -H "$AUTH" "$B/length/q")"
deq q; deq q; deq q
docker rm -f $NAME ${NAME}-holder >/dev/null
docker volume rm $TVOL >/dev/null
