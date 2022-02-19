FROM denoland/deno:1.19.0

ADD . /queue

RUN cd /queue && deno compile --allow-read --allow-write --allow-net --allow-env main.ts && cp ./queue /usr/bin/

CMD ["/usr/bin/queue"]
