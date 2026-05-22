# AGENTS.md

## 项目

- **名称**：pallas-community-stats（中心服务，非 Bot 本体）
- **Python**：3.12+
- **依赖**：`uv`

## 运行配置

- **主配置**：`config/stats.toml`（示例见 [`config/stats.example.toml`](config/stats.example.toml)）
- **遗留**：根目录 `.env` 只读合并，**不要**再作为唯一配置源
- **实现**：`src/pallas_community_stats/repo_settings.py`

## 可选 Redis

多实例部署且 `heartbeat_token` 为空（公开写入）时，可在 `stats.toml` 的 `[env]` 设置 `REDIS_URL` 与 `STATS_REDIS_RATE_LIMIT_ENABLED=auto`，用于跨进程限流；不可达时回退进程内 `ratelimit.py`。

```bash
uv sync --extra redis
```

## 本地命令

```bash
uv sync --group dev
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest
uv run pallas-community-stats
```

## 约定

- API 变更须同步 `docs/API.md` 与 `docs/client-integration.md`。
- 不存储 QQ、群号、消息；仅 `deployment_id` 与聚合计数。
- 默认不提交 `config/stats.toml`、`.env`、`data/`。

## Bot 侧

Pallas-Bot 仓库内的客户端实现另 PR；本仓库只维护中心服务与 HTTP 契约。
