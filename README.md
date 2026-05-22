# Pallas Community Stats

Pallas-Bot **opt-in** 社区统计中心服务：接收各部署自愿上报的心跳，对外提供公开的部署数 / 在线数聚合 API。

Bot 客户端尚未实现；集成约定见 [docs/client-integration.md](docs/client-integration.md)，HTTP 细节见 [docs/API.md](docs/API.md)。

## 快速开始

```bash
cd Pallas-Bot-Community-Stats
uv sync --group dev
cp .env.example .env
# 生产请设置 HEARTBEAT_TOKEN
uv run pallas-community-stats
```

默认监听 `http://0.0.0.0:8099`。

### 手动试 API

```bash
# 公开统计
curl -s http://127.0.0.1:8099/v1/stats | jq

# 心跳（未配置 token 时）
curl -s -X POST http://127.0.0.1:8099/v1/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"deployment_id":"550e8400-e29b-41d4-a716-446655440000","version":"3.0.0","online_bots":1}'
```

## Docker

```bash
docker compose up -d --build
```

数据卷挂载 `./data`，环境变量见 `.env.example`。

## 开发

```bash
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest
```

## 相关仓库

- [Pallas-Bot](https://github.com/PallasBot/Pallas-Bot) — 牛牛本体（未来将 opt-in 上报）
