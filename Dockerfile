# Build the Next app, then ship only the standalone server.
FROM node:22-alpine AS builder
WORKDIR /app

# The frontend ABI is generated from the Foundry artifact and committed, so the
# image never needs a Solidity toolchain.
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY web/ ./

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# they have to be present HERE — a runtime service variable arrives too late
# and leaves the browser with an unconfigured Para (and no sign-in).
ARG NEXT_PUBLIC_PARA_API_KEY
ARG NEXT_PUBLIC_PARA_ENV
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_PARA_API_KEY=$NEXT_PUBLIC_PARA_API_KEY \
    NEXT_PUBLIC_PARA_ENV=$NEXT_PUBLIC_PARA_ENV \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=:: PORT=8080

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "server.js"]
