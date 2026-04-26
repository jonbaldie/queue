FROM denoland/deno:2.7.6

ADD . /queue

WORKDIR /queue

RUN deno compile --allow-read --allow-write --allow-net --allow-env main.ts && cp ./queue /usr/bin/

CMD ["/usr/bin/queue"]
