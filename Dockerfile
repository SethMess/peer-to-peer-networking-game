FROM denoland/deno

EXPOSE 8100

WORKDIR /server

ADD . /game

RUN deno install --entrypoint ./server/siteserver.ts

CMD ["run", "--allow-net", "main.ts"]
