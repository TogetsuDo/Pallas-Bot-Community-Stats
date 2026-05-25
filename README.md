# Pallas Community Stats

Pallas-Bot **opt-in** 社区统计中心服务：接收各部署自愿上报的心跳，对外提供公开的部署数 / 在线数聚合 API。

Bot 侧见 [Pallas-Bot](https://github.com/PallasBot/Pallas-Bot) 的 `community_stats` 插件；约定见 [docs/client-integration.md](docs/client-integration.md)，HTTP 见 [docs/API.md](docs/API.md)。

## 官方共用中心

**`https://stats.pallasbot.top`** 为社区**唯一推荐的公共统计与语料中心**（`*.pallasbot.top` 子域即可，主域 `pallasbot.top` 在就行）：各部署默认 opt-in 上报与 auto enroll，**无需分发 token**。

运维约定（共用实例）：

- **`HEARTBEAT_TOKEN` 保持留空**（公开写入 + 限流）；不要对全体用户发私有密钥。
- 依赖 `HEARTBEAT_RATE_PER_IP_PER_MIN`、`HEARTBEAT_MIN_INTERVAL_SEC` 挡刷；异常可结合日志与 `stats.db` 备份。
- 反代仅暴露 443，应用监听 `127.0.0.1:8099`。

若另建私有中心，可自行设置 `HEARTBEAT_TOKEN`，Bot 端再配置对应 `token`（与公共实例无关）。

## 生产地址

公网 API 基址：**`https://stats.pallasbot.top`**：

| 用途 | URL |
| --- | --- |
| 公开统计 | `GET https://stats.pallasbot.top/v1/stats` |
| 心跳上报 | `POST https://stats.pallasbot.top/v1/heartbeat` |
| 存活探针 | `GET https://stats.pallasbot.top/health` |
| 语料 enroll | `POST https://stats.pallasbot.top/v1/corpus/enroll` |
| 语料读取 | `GET https://stats.pallasbot.top/v1/corpus/context` |

生产可改用其它 **`*.pallasbot.top`** 子域：在 `config/stats.toml` 设 `corpus_public_api_base = "https://<子域>/v1/corpus"`，反代指向本服务即可。

## 快速开始

```bash
cd Pallas-Bot-Community-Stats
uv sync --group dev
cp config/stats.example.toml config/stats.toml
# 共用中心：heartbeat_token 留空；私有实例再设 token
# 多实例 + 公开写入：在 [env] 配置 REDIS_URL 后 uv sync --extra redis
uv run pallas-community-stats
```

配置说明见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [AGENTS.md](AGENTS.md)。遗留 `.env` 仍可只读合并，勿再作为唯一配置源。

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

预构建镜像（`main` 推送后自动发布）：`docker pull <DOCKERHUB_USERNAME>/pallas-community-stats:latest`

```bash
docker compose up -d --build
```

数据卷挂载 `./data`，环境变量见 `.env.example`。公网 HTTPS 建议在宿主机用反向代理；仅本机监听可用 `docker compose -f docker-compose.deploy.yml up -d --build`（见 `Dockerfile.cn`）。

## 开发

```bash
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest
```

## 相关仓库

- [Pallas-Bot](https://github.com/PallasBot/Pallas-Bot) — 牛牛本体（未来将 opt-in 上报）
