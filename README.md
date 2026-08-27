# Queue server

Fast, portable queue server written in Typescript and built with Deno.

[![CI](https://github.com/jonbaldie/queue/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jonbaldie/queue/actions/workflows/ci.yml)

## Introduction

This is a fast and easy-to-use FIFO queue server which can run on any platform, and using it is as simple as using two HTTP endpoints.

You can separate your payloads into as many different queues as you like, so your application can use this to enqueue different types of payloads and keep them separated.

It is ideal as a simple, fast work queue, for dispatching time-consuming tasks that your application can run asynchronously. But it is just as useful as a message broker.

## How to install

Download the latest executable for your OS, and then `mv` it to a directory within your `$PATH`.

* [Linux](https://d22pgfyez1vmkm.cloudfront.net/x86_64-unknown-linux-gnu/queue)
* [Apple (Intel)](https://d22pgfyez1vmkm.cloudfront.net/x86_64-apple-darwin/queue)
* [Apple (Silicon)](https://d22pgfyez1vmkm.cloudfront.net/aarch64-apple-darwin/queue)

Simply run `queue` to start up the server, listening on http://127.0.0.1:3000 by default.

It might be easier to use the Docker image like so:

```
docker run -d -e HOST=127.0.0.1 -e PORT=1991 jonbaldie/queue
```

It will then listen to http://127.0.0.1:1991.

Note the use of environment variables to change the listening address - these also work for the executable.

## Usage

Once started, you interact with the server using HTTP requests.

To queue up your first payload, send a post request to `/enqueue/:queue` with the payload in your request's JSON body

```
curl -X POST -H "Content-Type: application/json" -d '{"payload": "bar"}' http://127.0.0.1:1991/enqueue/foo
```

The server has also just created the `foo` queue for you, if it didn't already exist, making the interface easier.

You're best setting up a publisher script in your application to write payloads using the enqueue endpoint, and then subscriber scripts in your application can read those payloads using the dequeue endpoint.

To get the next payload from the `foo` queue, send a get request to `/dequeue/:queue`

```
curl -X GET http://127.0.0.1:1991/dequeue/foo
```

This returns the oldest added payload on queue `foo` as JSON and removes it, guaranteeing both the order and that each payload will only be read once. Strings, numbers, booleans, arrays, and objects all use `application/json` so a string `"0"` is distinct from the number `0`.

That's all you need to get started! 😎

## Production quality gate

The production TypeScript quality gate uses messcript at the pinned commit
`4fe47bd0f15675206aedd0f22ae5eff7aeb01707`. The Node wrapper checks out that
revision into the ignored `node_modules/.cache/queue-messcript` directory,
installs its locked dependencies, builds it, and then runs the CLI. It does not
affect the Deno service or its dependencies.

Run a named production unit with Node 20.11 or newer:

```
npm run quality:unit -- configuration
```

The available units are `configuration`, `router`, `middleware`,
`rate-limiter`, `queue-manager`, `persist-engine`, `http-handler`, and
`entrypoint`. Run the complete production gate with:

```
npm run quality:production
```

Both commands use messcript's recommended `typescript` policy, including its
default `CyclomaticComplexity` and `NPathComplexity` rules and thresholds. The
aggregate scope is explicit: it includes only the eight production units above
and excludes tests, mutation infrastructure, documentation, CI configuration,
generated output, and development tooling. Findings and processing errors
retain messcript's normal non-zero exit status.

To get the number of payloads pending on a queue, send a get request to `/length/:queue`

```
curl -X GET http://127.0.0.1:1991/length/foo
```

## Demo

![h11pcanjwrm8khsyu4w4](https://github.com/jonbaldie/queue/assets/8376953/c9271432-e739-4dfe-8d39-269fa593297a)

## FIFO

This is a FIFO ("First-in, First-out") queue server, meaning that the oldest payload is processed first.

The dequeue endpoint will always send you the earliest pending payload that you've enqueued onto that queue.

Every payload is also guaranteed to only be read once using the dequeue endpoint, meaning it is ideal for use as a worker queue server.

## Persistency

Persistency is opt-in. That means that by default this server will not remember your queue jobs if you turn it off.

To get persistency, simply add the `--persist` option when starting up the server, and it will write changes to a binary log file:

```
docker run -d -e PORT=1991 -e HOST=0.0.0.0 -e PERSIST=/mnt/ jonbaldie/queue /usr/bin/queue --persist
```

If the server sees that the `persist.dat` file exists on startup, it will replay the binary log and then rewrite the file as a snapshot of remaining items.

When using Docker, it might be useful to add `persist.dat` as a persistent volume to keep your binary logs safe.

It should go without saying, but try not to edit `persist.dat`, because it might result in weird behaviour.
