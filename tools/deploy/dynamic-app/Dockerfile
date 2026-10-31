# Task track3-eaton-centre-20261031 (lane PACKAGE): rootless static-server image for the dynamic Terminal State app.
# Build context = the directory written by stage.mjs (this Dockerfile, server.mjs, site-manifest.mjs, wrapper-source.json,
# manifest.json and site/ from the OFFICIAL merged-main CI artifact of the SAME commit). See CONTRACT.md. Main builds and
# deploys it; workers never do. No npm install, no dependencies, no database, no capabilities, no writable paths.
#
#   docker build --build-arg SOURCE_COMMIT=<40-hex merged-main sha> -t terminal-state-dynamic:<sha> <staged dir>
#
# NODE_IMAGE: Node 22 (the CI / worker version). Main should pin it to an immutable digest when building, e.g.
#   --build-arg NODE_IMAGE=node:22.16.0-bookworm-slim@sha256:<digest>
ARG NODE_IMAGE=node:22.16.0-bookworm-slim
FROM ${NODE_IMAGE}

ARG SOURCE_COMMIT
LABEL org.opencontainers.image.title="terminal-state-dynamic" \
      org.opencontainers.image.description="Official Terminal State CI site served by a zero-dependency Node static server" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}"

WORKDIR /app
# Root-owned copies (COPY default): the runtime user (uid 1000) can read but never modify the server or the site. No later
# chmod / chown: re-permissioning would duplicate every site file into another layer. The Dockerfile itself is kept in the
# image too (its sha256 is part of the staged wrapper record).
COPY Dockerfile server.mjs site-manifest.mjs wrapper-source.json manifest.json /app/
COPY site/ /app/site/

# Fail the build unless the site is exactly the official manifest (every sha256), the manifest commit is SOURCE_COMMIT and
# the wrapper files are the ones recorded at staging for that same commit. (Read-only: adds no file to the image.)
RUN test -n "${SOURCE_COMMIT}" \
 && node /app/site-manifest.mjs verify --site /app/site --manifest /app/manifest.json --commit "${SOURCE_COMMIT}" --hashes --wrapper /app/wrapper-source.json

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    BASE_PATH=/ \
    SITE_DIR=/app/site \
    MANIFEST=/app/manifest.json \
    EXPECTED_COMMIT=${SOURCE_COMMIT}

# The official node image's unprivileged `node` user (uid / gid 1000), numeric so runAsNonRoot can verify it.
USER 1000:1000
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "require('http').get({host:'127.0.0.1',port:process.env.PORT,path:'/healthz'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "/app/server.mjs"]
