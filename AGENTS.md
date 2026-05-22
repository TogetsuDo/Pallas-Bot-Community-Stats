# AGENTS.md

## 项目

- **名称**：pallas-community-stats（中心服务，非 Bot 本体）
- **Python**：3.12+
- **依赖**：`uv`

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
- 默认不提交 `.env`、`data/`。

## Bot 侧

Pallas-Bot 仓库内的客户端实现另 PR；本仓库只维护中心服务与 HTTP 契约。
