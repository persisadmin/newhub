# PERSIS — production build
# node:20-slim (glibc) — required for native deps (esbuild, unrs-resolver).
# npm is upgraded first: the npm 10.8.2 bundled with node:20 images crashes
# during `npm ci` ("Exit handler never called").
#
# NOTE: the deps stage regenerates package-lock.json against the public npm
# registry before `npm ci`. This makes the build immune to lockfiles whose
# `resolved` URLs point at unreachable private mirrors.

FROM node:20-slim AS deps
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json ./
# Lockfiles generated against a private/mirror registry break `npm ci` on
# builders without access to it. Rewrite any non-npmjs resolved URLs first.
RUN sed -i 's#https://[^/]*msh\.team#https://registry.npmjs.org#g' package-lock.json 2>/dev/null || true \
 && npm config set registry https://registry.npmjs.org \
 && npm install --package-lock-only --registry=https://registry.npmjs.org --no-audit --no-fund \
 && npm ci --no-audit --no-fund

FROM node:20-slim AS build
WORKDIR /app
RUN npm install -g npm@11
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only — real secrets are injected at runtime by Railway.
ENV NEXTAUTH_SECRET=build-time-placeholder-secret \
    MONGODB_URI=mongodb://localhost:27017
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
# poppler-utils provides pdftoppm, used to render scanned PDF pages for Kimi vision OCR.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "start"]
