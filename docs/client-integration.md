# Bot 客户端集成约定（规划）

> 本文描述 **Pallas-Bot 侧** 未来实现时的约定；当前仓库仅提供中心服务，Bot 代码尚未接入。

## 启用方式

- `config/pallas.toml` 中 `[community_stats] enabled = true`（默认 `false`）。
- 配置 `endpoint` 为中心服务 `POST /v1/heartbeat` 的完整 URL。
- 可选 `token`，与中心 `HEARTBEAT_TOKEN` 一致。

## `deployment_id`

- 首次启用时生成 UUID v4，持久化到 `data/pallas_config/community_stats.json`。
- 重装或清空数据视为新部署（新 ID）。

## 上报时机

| 事件 | 行为 |
| --- | --- |
| 进程启动（hub 或单进程） | 立即心跳 + 注册周期任务（建议 300s） |
| 周期任务 | 按 `interval_sec` 上报 |
| 分片 | **仅 hub** 发送，避免同一物理机 N 条记录 |

## 负载字段来源（Pallas 实现参考）

| 字段 | 建议来源 |
| --- | --- |
| `online_bots` | 分片：`len(get_cluster_online_bot_ids())`；单进程：`len(get_bots())` |
| `catalog_bots` | `len(get_fleet_bot_ids())` 或 block 名册 |
| `sharded` | `is_sharding_active()` |
| `shard_workers` | `registry.json` 中 worker 条数 |
| `version` | 插件/仓库版本常量 |

## 失败策略

- 网络错误：记录 `warning`，不阻断启动与消息处理。
- 401/400：记录 `warning`，提示配置检查；不要高频重试。

## 展示

运营方可将 `GET /v1/stats` 用于官网徽章、README 动态数字或群公告（由独立脚本轮询，非 Bot 必需）。
