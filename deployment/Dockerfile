# syntax=docker/dockerfile:1.6

ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
ENV NODE_ENV=production
RUN npm ci --omit=dev
COPY stwSpinner.js ./
COPY stwComponents ./stwComponents
COPY stwContents ./stwContents
COPY stwElements ./stwElements
COPY public ./public
COPY webbaselets ./webbaselets
COPY stwStyles ./stwStyles
COPY deployment/entrypoint.sh deployment/config-server.mjs ./deployment/
COPY .env.example ./.env
COPY LICENSE README.md ./

RUN mkdir -p .data .cert \
    && chown -R node:node /app \
    && chmod +x /app/deployment/entrypoint.sh

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || '8080')).then(() => process.exit(0)).catch(() => process.exit(1))"

ENV HOST=0.0.0.0
ENV PORT=8080
ENV ALLOW_DEV=false
ENV SPINNER_ENV=docker

ENTRYPOINT ["/app/deployment/entrypoint.sh"]
