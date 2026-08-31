FROM denoland/deno:2.7.6

COPY . /queue

WORKDIR /queue

RUN deno compile --allow-read --allow-write --allow-net --allow-env=HOST,PORT,PERSIST,QUEUE_API_TOKEN,QUEUE_DEPTH_LIMIT,QUEUE_COUNT_LIMIT,RATE_LIMIT_REQUESTS --allow-sys main.ts && cp ./queue /usr/bin/

RUN chown -R deno:deno /queue /usr/bin/queue

USER deno

CMD ["/usr/bin/queue"]
