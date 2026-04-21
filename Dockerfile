FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV PYTHON_BIN=python3

COPY package*.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir extract-msg beautifulsoup4 \
  && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/types.ts ./src/types.ts

RUN mkdir -p /app/data/uploads
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["npm", "start"]
