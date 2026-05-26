# Pallas Community Stats

Pallas-Bot **opt-in** 社区统计与**共享语料**中心：接收各部署自愿上报的心跳，提供公开聚合 API 与 Bot 外接语料库（`/v1/corpus/*`）。

- Bot 侧：`community_stats` 插件 + `[corpus]` auto enroll（见 [Pallas-Bot](https://github.com/PallasBot/Pallas-Bot)）
- HTTP 约定：[docs/API.md](docs/API.md) · 客户端集成：[docs/client-integration.md](docs/client-integration.md)

## 官方公共实例

**`https://stats.pallasbot.top`** 为社区推荐的生产入口。

| 用途 | URL |
| --- | --- |
| 公开统计 | `GET /v1/stats` |
| 监控聚合 | `GET /v1/monitor/overview` |
| 心跳 | `POST /v1/heartbeat` |
| 健康检查 | `GET /health` |
| 语料 enroll | `POST /v1/corpus/enroll` |
| 语料读取 | `GET /v1/corpus/context` |
| 联邦 bootstrap | `GET /v1/bootstrap`（Bot 鉴权拉取池 ID + 协调 Redis） |
| Phase 2 入池说明 | `GET /v1/federation/onboarding`（控制台展示步骤与入池密钥） |

各 Bot 默认 opt-in 上报与 auto enroll，**语料与心跳无需向用户分发 token**。公共实例约定：`heartbeat_token` 留空 + IP/部署限流；详见下文「共用中心运维」。

**联邦 Phase 2**（跨 deployment ingress 去重）：Bot **直连**协调 Redis，中心仅通过 bootstrap 下发 `federate_id` 与 `coord.redis_url`，不经 HTTP 转发群消息。入池密钥为 `INSTANCE_SECRET`（与 bootstrap Bearer 相同），可由控制台「统计与语料」页拉取 `/v1/federation/onboarding` 展示；协调 Redis 公网部署见 [deploy/coord-redis.pallas.top.md](deploy/coord-redis.pallas.top.md)。

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
CORPUS_DEFAULT_CONTRIBUTE = "true"

# 联邦 bootstrap（Phase 2 ingress 去重；Bot 控制台可展示入池说明）
# BOOTSTRAP_ENABLED = "true"
# INSTANCE_SECRET = "change-me"
# FEDERATE_ID = "public-pool"
# FEDERATE_COORD_REDIS_URL = "redis://:<password>@coord.pallasbot.top:6380/2"
# FEDERATION_ONBOARDING_PUBLISH_SECRET = "true"
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

公网请用 Nginx/Caddy 反代到 `127.0.0.1:8099`。

**推荐（独立子域，一条 `location /` 覆盖全部 API）**：[deploy/nginx-stats.pallasbot.top.conf](deploy/nginx-stats.pallasbot.top.conf)

```bash
sudo cp deploy/nginx-stats.pallasbot.top.conf /etc/nginx/sites-available/stats.pallasbot.top
sudo ln -sf /etc/nginx/sites-available/stats.pallasbot.top /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d stats.pallasbot.top
```

备案过渡期若只能挂在已有域名下，用片段 [deploy/nginx-pallas-community-stats-locations.conf](deploy/nginx-pallas-community-stats-locations.conf)（白名单路径；**新增中心 API 时须同步补 location**，主站 `stats.pallasbot.top` 为 `location /` 全量反代无需逐条加）。

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

### 5. 联邦协调 Redis（Phase 2，可选）

跨 deployment **ingress 去重**需要各 Bot 可达的协调 Redis（与语料/限流 Redis 可同实例、不同 DB）。公网子域、端口与安全组见 [deploy/coord-redis.pallas.top.md](deploy/coord-redis.pallas.top.md)。

中心 `stats.toml` 启用 bootstrap 后，Bot 用 `INSTANCE_SECRET` 调 `GET /v1/bootstrap` 自动落盘；运维也可在 Bot 控制台「统计与语料」查看 `GET /v1/federation/onboarding`（公开说明 + 可选下发入池密钥）。

| 环境变量 | 说明 |
| --- | --- |
| `BOOTSTRAP_ENABLED` | 开启 bootstrap |
| `INSTANCE_SECRET` | 入池密钥（bootstrap Bearer；勿与 `heartbeat_token` 混用） |
| `FEDERATE_ID` | 联邦池 ID |
| `FEDERATE_COORD_REDIS_URL` | Bot 直连的协调 Redis（含密码，由 bootstrap 下发） |
| `FEDERATION_ONBOARDING_ENABLED` | 入池说明 API；留空则 bootstrap 就绪时自动开放 |
| `FEDERATION_ONBOARDING_PUBLISH_SECRET` | 默认 `true`；`false` 时 onboarding 不返回明文密钥 |

示例 Compose 见 [deploy/docker-compose.coord-redis.example.yml](deploy/docker-compose.coord-redis.example.yml)。

---

## 共用中心运维要点

| 项 | 建议 |
| --- | --- |
| `heartbeat_token` | **留空**（公开写入 + 限流）；勿向全体 Bot 用户发私钥 |
| 限流 | `heartbeat_rate_per_ip_per_min`、`heartbeat_min_interval_sec` |
| 语料贡献 | 默认 **开**（`corpus_default_contribute = true`）；Bot auto enroll 后 mirror 学习结果 |
| 备份 | 定期备份 `data/stats.db` |
| 暴露面 | 反代只开 443；应用 **不要** `0.0.0.0:8099` 裸奔公网 |
| 联邦入池 | `INSTANCE_SECRET` 仅给信任部署；`FEDERATION_ONBOARDING_PUBLISH_SECRET=false` 可关闭控制台明文展示 |
| 协调 Redis | 公网暴露时强密码 + 安全组；Bot 直连，中心不代理消息 |

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

## 预灌社区语料（可选）

中心刚启用时池子为空，可从某台 Bot 本地 PG **挑选一部分**上传：

```bash
# 在 Pallas-Bot 仓库（feat/corpus-phase1+）
uv run python tools/seed_community_corpus.py --dry-run
uv run python tools/seed_community_corpus.py --limit 2000 --min-answer-count 3
```

仅上传 `keywords` + 短句，`group_id=0`；默认 enroll 后 POST 到 `stats.pallasbot.top`。

---

## CI 与发版

- `main` 推送触发 [`.github/workflows/docker-image.yml`](.github/workflows/docker-image.yml)，构建并推送 `togetsudo/pallas-community-stats:latest`（amd64 + arm64）。
- 仓库 Actions secrets：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`（Hub 登录用）。

## 相关仓库

- [Pallas-Bot](https://github.com/PallasBot/Pallas-Bot) — 牛牛本体（community_stats + corpus Phase 1）
