FROM denoland/deno:2.7.6

COPY . /queue

WORKDIR /queue

RUN deno run --frozen --allow-run scripts/compile.ts /usr/bin/queue

RUN mkdir -p /data && chown -R deno:deno /queue /usr/bin/queue /data

# Persistence directory owned by the runtime user; named volumes mounted here inherit that ownership.
ENV PERSIST=/data/
VOLUME /data

USER deno

CMD ["/usr/bin/queue"]
