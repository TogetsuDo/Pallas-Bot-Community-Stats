# Pallas Community Stats

Pallas-Bot **opt-in** 社区统计与**共享语料**中心：接收各部署自愿上报的心跳，提供公开聚合 API 与 Bot 外接语料库（`/v1/corpus/*`）。

- Bot 侧：`community_stats` 插件 + `[corpus]` auto enroll（见 [Pallas-Bot](https://github.com/PallasBot/Pallas-Bot)）
- HTTP 约定：[docs/API.md](docs/API.md) · 客户端集成：[docs/client-integration.md](docs/client-integration.md)

## 官方公共实例

**`https://stats.pallasbot.top`** 为社区推荐的生产入口（`*.pallasbot.top` 子域即可，主域 `pallasbot.top` 在就行）。

| 用途 | URL |
| --- | --- |
| 公开统计 | `GET /v1/stats` |
| 心跳 | `POST /v1/heartbeat` |
| 健康检查 | `GET /health` |
| 语料 enroll | `POST /v1/corpus/enroll` |
| 语料读取 | `GET /v1/corpus/context` |

各 Bot 默认 opt-in 上报与 auto enroll，**无需向用户分发 token**。公共实例约定：`heartbeat_token` 留空 + IP/部署限流；详见下文「共用中心运维」。

---

## 生产部署（Docker Compose）

预构建镜像（`main` 推送后自动发布）：

**[togetsudo/pallas-community-stats:latest](https://hub.docker.com/r/togetsudo/pallas-community-stats)**

### 1. 准备目录与配置

```bash
git clone https://github.com/TogetsuDo/Pallas-Bot-Community-Stats.git
cd Pallas-Bot-Community-Stats

mkdir -p data config
cp config/stats.example.toml config/stats.toml
```

编辑 `config/stats.toml`（**勿提交**）。可从示例复制后重点确认 `[bootstrap]` 与 `[env]`：

```toml
[bootstrap]
host = "0.0.0.0"
port = 8099
db_path = "data/stats.db"
heartbeat_token = ""   # 公共实例留空；私有实例再设 Bearer

[env]
CORPUS_ENABLED = "true"
CORPUS_PUBLIC_API_BASE = "https://stats.pallasbot.top/v1/corpus"
CORPUS_DEFAULT_CONTRIBUTE = "false"
```

### 2. 启动

```bash
docker compose pull
docker compose up -d
curl -s http://127.0.0.1:8099/health
```

默认 **仅监听 `127.0.0.1:8099`**，数据持久化在 `./data/stats.db`。升级：

```bash
docker compose pull && docker compose up -d
```

指定版本（workflow 同时推送 `sha-<commit>` 标签）：

```bash
IMAGE_TAG=sha-28a6ab6 docker compose pull && docker compose up -d
```

### 3. HTTPS 反向代理

公网请用 Nginx/Caddy 反代到 `127.0.0.1:8099`，示例见 [deploy/nginx-stats.pallasbot.top.conf](deploy/nginx-stats.pallasbot.top.conf)。备案过渡期可只暴露 heartbeat/stats，见 [deploy/nginx-pallas-community-stats-locations.conf](deploy/nginx-pallas-community-stats-locations.conf)。

### 4. 多实例 + Redis 限流（可选）

公开写入且水平扩展时，在 `stats.toml` 增加：

```toml
[env]
REDIS_URL = "redis://redis:6379/1"
STATS_REDIS_RATE_LIMIT_ENABLED = "auto"
```

```bash
docker compose --profile redis up -d
```

（Compose 内 `redis` 服务与 stats 同网；若用宿主机 Redis，URL 改为 `redis://127.0.0.1:6379/1` 并自行保证 stats 容器可达。）

---

## 共用中心运维要点

| 项 | 建议 |
| --- | --- |
| `heartbeat_token` | **留空**（公开写入 + 限流）；勿向全体 Bot 用户发私钥 |
| 限流 | `heartbeat_rate_per_ip_per_min`、`heartbeat_min_interval_sec` |
| 语料贡献 | 默认 **关**（`corpus_default_contribute = false`） |
| 备份 | 定期备份 `data/stats.db` |
| 暴露面 | 反代只开 443；应用 **不要** `0.0.0.0:8099` 裸奔公网 |

私有中心：自行设置 `heartbeat_token`，Bot 端配置对应 token 即可。

---

## Compose 文件说明

| 文件 | 用途 |
| --- | --- |
| `docker-compose.yml` | **生产默认**：预构建镜像 + `127.0.0.1:8099` |
| `docker-compose.dev.yml` | 本地调试，对外暴露 `${PORT}` |
| `docker-compose.build.yml` | 从源码 `docker build`（贡献者） |
| `docker-compose.cn.yml` | 占位说明；国内请先配 Docker Hub 镜像加速再 `pull` |

本地调试示例：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

---

## 开发（源码）

```bash
uv sync --group dev
cp config/stats.example.toml config/stats.toml
uv run pallas-community-stats
```

```bash
uv run ruff check src tests
uv run pytest
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)、[AGENTS.md](AGENTS.md)。

## CI 与发版

- `main` 推送触发 [`.github/workflows/docker-image.yml`](.github/workflows/docker-image.yml)，构建并推送 `togetsudo/pallas-community-stats:latest`（amd64 + arm64）。
- 仓库 Actions secrets：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`（Hub 登录用）。

## 相关仓库

- [Pallas-Bot](https://github.com/PallasBot/Pallas-Bot) — 牛牛本体（community_stats + corpus Phase 1）
