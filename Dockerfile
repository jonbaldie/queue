FROM denoland/deno:2.7.6

ARG DENO_HOST=0.0.0.0
ARG DENO_PORT=3000

COPY . /queue

WORKDIR /queue

RUN deno compile --allow-read --allow-write=./persist.dat --allow-net=${DENO_HOST}:${DENO_PORT} --allow-env=HOST,PORT,PERSIST,QUEUE_API_TOKEN,QUEUE_DEPTH_LIMIT,QUEUE_COUNT_LIMIT,RATE_LIMIT_REQUESTS --allow-sys main.ts && cp ./queue /usr/bin/

RUN chown -R deno:deno /queue /usr/bin/queue

USER deno

CMD ["/usr/bin/queue"]
