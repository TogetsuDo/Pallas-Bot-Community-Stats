# Bot 客户端集成约定

Pallas-Bot 见 `src/common/community_stats/` 与 `src/plugins/community_stats/`。

## 启用方式

- `config/pallas.toml` 中 `[community_stats] enabled = true`（默认 **true**）。
- `endpoint` 默认 `https://stats.pallasbot.top/v1/heartbeat`。
- **`token` 默认留空**；仅当中心配置了 `HEARTBEAT_TOKEN` 时才需填写。

## `deployment_id`

- 首次上报前生成 UUID v4，持久化到 `data/pallas_config/community_stats.json`。

## 上报时机

| 事件 | 行为 |
| --- | --- |
| hub / 单进程启动 | 立即心跳 + 周期任务（默认 300s） |
| 分片 worker | **不上报** |

## 失败策略

- 网络 / 401 / 429 / 400：记 `warning`，不阻断 Bot。
