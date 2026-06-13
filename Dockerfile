FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir uv

COPY pyproject.toml README.md ./
COPY src ./src
COPY --from=web /web/dist ./src/pallas_community_stats/hub_static

RUN uv pip install --system ".[redis]"

VOLUME ["/app/data"]
ENV DB_PATH=/app/data/stats.db \
    HOST=0.0.0.0 \
    PORT=8099

EXPOSE 8099

CMD ["pallas-community-stats"]
