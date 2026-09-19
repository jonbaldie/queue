FROM denoland/deno:2.7.6

COPY . /queue

WORKDIR /queue

RUN deno compile --allow-read --allow-write --allow-net --allow-env=HOST,PORT,PERSIST,QUEUE_API_TOKEN,QUEUE_DEPTH_LIMIT,QUEUE_COUNT_LIMIT,RATE_LIMIT_REQUESTS --allow-sys main.ts && cp ./queue /usr/bin/

RUN mkdir -p /data && chown -R deno:deno /queue /usr/bin/queue /data

# Persistence directory owned by the runtime user; named volumes mounted here inherit that ownership.
ENV PERSIST=/data/
VOLUME /data

USER deno

CMD ["/usr/bin/queue"]
