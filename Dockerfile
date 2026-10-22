FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12.15-slim

# uv 工具版本与 uv.lock 的解析器保持一致（见 uv.lock revision）。
COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /uvx /bin/

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

COPY pyproject.toml uv.lock README.md ./
COPY src ./src
COPY --from=web /web/dist ./src/pallas_community_stats/hub_static

# --locked 让镜像真正消费 uv.lock（否则重新解析、安全下限不生效）。
RUN uv sync --locked --no-dev --extra redis --no-editable

VOLUME ["/app/data"]
ENV PATH="/app/.venv/bin:$PATH" \
    DB_PATH=/app/data/stats.db \
    HOST=0.0.0.0 \
    PORT=8099

EXPOSE 8099

CMD ["pallas-community-stats"]
