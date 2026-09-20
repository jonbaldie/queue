## Build: local image queue-explore:e0d2108 from main e0d2108
$ docker run -d --name qx-readme -e QUEUE_API_TOKEN=explore-token -e PORT=1991 -e HOST=0.0.0.0 -e PERSIST=/mnt/ -p 19991:1991 queue-explore:e0d2108 /usr/bin/queue --persist
e0c15d7084a2701abb25aa8b43e077a192da6bfb5d3323e056526cb5786f81f0
$ docker ps -a --filter name=qx-readme --format "{{.Status}}"
Exited (1) 2 seconds ago
$ docker logs qx-readme
Loading in data from persist.dat...

[0m[1m[31merror[0m: Uncaught (in promise) PermissionDenied: Permission denied (os error 13): open '/mnt/persist.dat'
            this.writeHandle = Deno.openSync(this.path, { write: true, create: true, append: true });
[0m[31m                                    ^[0m
    [0m[2m[38;5;245mat [0m[0m[2m[38;5;245mObject.openSync[0m[0m[2m[38;5;245m ([0m[0m[2m[38;5;245mext:deno_fs/30_fs.js[0m[0m[2m[38;5;245m:[0m[0m[2m[38;5;245m545[0m[0m[2m[38;5;245m:[0m[0m[2m[38;5;245m15[0m[0m[2m[38;5;245m)[0m
    at [0m[1m[3mFileStore.ensureOpen[0m ([0m[36mfile:///tmp/deno-compile-queue/src/persist.ts[0m:[0m[33m62[0m:[0m[33m37[0m)
    at [0m[1m[3mFileStore.clear[0m ([0m[36mfile:///tmp/deno-compile-queue/src/persist.ts[0m:[0m[33m102[0m:[0m[33m14[0m)
    at [0m[1m[3mManager.save[0m ([0m[36mfile:///tmp/deno-compile-queue/src/manager.ts[0m:[0m[33m168[0m:[0m[33m20[0m)
    at [0m[1m[3mManager.load[0m ([0m[36mfile:///tmp/deno-compile-queue/src/manager.ts[0m:[0m[33m182[0m:[0m[33m14[0m)
    at [0m[36mfile:///tmp/deno-compile-queue/main.ts[0m:[0m[33m50[0m:[0m[33m13[0m
$ curl enqueue
curl: (7) Failed to connect to 127.0.0.1 port 19991 after 0 ms: Couldn't connect to server
 [000]
$ docker run --rm --entrypoint ls queue-explore:e0d2108 -ld /mnt
drwxr-xr-x 1 root root 0 Mar 16  2026 /mnt
$ docker run --rm --entrypoint id queue-explore:e0d2108
uid=1993(deno) gid=1993(deno) groups=1993(deno)

## Repeat observation (fresh container)
status: Exited (1) 2 seconds ago
error: Uncaught (in promise) PermissionDenied: Permission denied (os error 13): open '/mnt/persist.dat'
