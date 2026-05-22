# Pallas Community Stats 贡献指南

## 运行配置

- **主配置**：复制 [`config/stats.example.toml`](config/stats.example.toml) 为 **`config/stats.toml`**（勿提交密钥）。
- **遗留 `.env`**：仍可只读合并，优先级**低于** `stats.toml`；新项请写入 TOML。
- **读取**：`src/pallas_community_stats/repo_settings.py`；`get_settings()` 启动前会 `apply_settings_to_environ()`。

## 可选 Redis（多实例限流）

公开写入模式（`heartbeat_token` 为空）下，多副本部署建议在 `stats.toml` 的 `[env]` 配置：

```toml
[env]
REDIS_URL = "redis://127.0.0.1:6379/1"
STATS_REDIS_RATE_LIMIT_ENABLED = "auto"
```

- `auto`：能 ping 通 Redis 则用分布式限流，否则进程内限流。
- 依赖：`uv sync --extra redis`

与 Pallas-Bot / Pallas-Bot-AI 共用同一 Redis 实例时，请使用**不同 logical DB**（URL 末尾 `/0`、`/1` 等）。

## 本地开发

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

详见 [AGENTS.md](AGENTS.md)。
