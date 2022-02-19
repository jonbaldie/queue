# Queue server

Fast, portable queue server written in Typescript and built with Deno.

[![CircleCI](https://circleci.com/gh/jonbaldie/queue/tree/main.svg?style=shield)](https://circleci.com/gh/jonbaldie/queue/tree/main)

## Introduction

This is a fast and easy-to-use FIFO queue server which can run on any platform, and using it is as simple as using two HTTP endpoints.

You can separate your payloads into as many different queues as you like, so your application can use this to enqueue different types of payloads and keep them separated.

It is ideal as a simple, fast work queue, for dispatching time-consuming tasks that your application can run asynchronously. But it is just as useful as a message broker.

## How to install

Download the latest executable for your OS.

* [Linux](https://d22pgfyez1vmkm.cloudfront.net/x86_64-unknown-linux-gnu/queue)
* [Apple (Intel)](https://d22pgfyez1vmkm.cloudfront.net/x86_64-apple-darwin/queue)
* [Apple (Silicon)](https://d22pgfyez1vmkm.cloudfront.net/aarch64-apple-darwin/queue)

It might be easier to use the Docker image like so:

```
docker run -d -e PORT=1991 -e HOST=127.0.0.1 jonbaldie/queue:1.19.0
```

It will then listen to http://127.0.0.1:1991.

## Usage

Once started, you interact with the server using HTTP requests.

To queue up your first payload, send a post request to `/enqueue/:queue` with the payload in your request's JSON body:

```
curl -X POST -H "Content-Type: application/json" -d '{"payload": "bar"}' http://127.0.0.1:1991/enqueue/foo
```

The server has also just created the `foo` queue for you, if it didn't already exist, making the interface easier.

You're best setting up a publisher script in your application to write payloads using the enqueue endpoint, and then subscriber scripts in your application can read those payloads using the dequeue endpoint.

To get the next payload from the `foo` queue, send a get request to `/dequeue/:queue`:

```
curl -X GET http://127.0.0.1:1991/dequeue/foo
```

This returns the oldest added payload on queue `foo` and removes it, guaranteeing both the order and that each payload will only be read once.

That's all you need to get started! 😎

To get the number of payloads pending on a queue, send a get request to `/length/:queue`:

```
curl -X GET http://127.0.0.1:1991/length/foo
```

## FIFO

This is a FIFO ("First-in, First-out") queue server, meaning that the oldest payload is processed first.

The dequeue endpoint will always send you the earliest pending payload that you've enqueued onto that queue.

Every payload is also guaranteed to only be read once using the dequeue endpoint, meaning it is ideal for use as a worker queue server.

## Persistency

Persistency is opt-in. That means that by default this server will not remember your queue jobs if you turn it off.

To get persistency, simply add the `--persist` option when starting up the server, and it will write changes to a binary log file:

```
docker run -d -e PORT=1991 -e HOST=0.0.0.0 -e PERSIST=/mnt/ jonbaldie/queue:1.19.0 /usr/bin/queue --persist
```

If the server sees that the `persist.dat` file exists on startup, it will run the binary log from the beginning and then clear the file down.

When using Docker, it might be useful to add `persist.dat` as a persistent volume to keep your binary logs safe.

It should go without saying, but try not to edit `persist.dat`, because it might result in weird behaviour.

Maintained by Jonathan Baldie <jon@jonbaldie.com>

