# Bot 客户端集成约定

Pallas-Bot 实现：

- 插件壳：`packages/pb_stats/`
- 业务：`pallas/product/community_stats/`
- 用户说明：[docs/common/community_stats.md](https://github.com/PallasBot/Pallas-Bot/blob/main/docs/common/community_stats.md)

## 启用方式

- `config/pallas.toml` 中 `[community_stats] enabled = true`（默认 **true**）。
- WebUI：**插件 → 在线统计（pb_stats）**（旧「通用配置 / community-stats-config」会重定向至此）。
- `endpoint` 默认 `https://stats.pallasbot.top/v1/heartbeat`。
- **`token` 默认留空**；仅当中心配置了 `HEARTBEAT_TOKEN` 时才需填写。

## `deployment_id`

- 首次上报前生成 UUID v4，持久化到 `data/pallas_config/community_stats.json`。

## 上报时机

| 事件 | 行为 |
| --- | --- |
| hub / 单进程启动 | 约 60s 后首包 + 周期任务（默认 300s） |
| 分片 worker | **不上报** |
| 配置热重载 | 重启周期任务 |

## 名册字段（摘要）

| 字段 | 说明 |
| --- | --- |
| `roster_public` | 是否附带名册；关闭则中心清除该部署名册 |
| `roster_show_qq` | 是否在公开 bubble API 露出 QQ / 资料卡 |
| `roster_show_profile` | 是否露出头像与昵称 |
| `roster[]` | 名册条目（最多 256）；Bot 侧还可按实例开关排除单只牛 |

完整契约见 [API.md](./API.md)。

## 社区投稿代理

- 实现：`pallas/product/community_stats/gallery_client.py`
- 控制台：`/pallas/api/community-gallery` → 中心 `/v1/gallery/posts`
- 写操作附带本机 `deployment_id`；有语料 / 心跳 token 时带 Bearer
- 列表 `mine=true` 时按本部署筛选
- 用户入口：控制台 **统计与语料 → 社区投稿**

完整契约见 [API.md](./API.md) § 社区投稿；主站展示见 [community-hub.md](./community-hub.md)。

## 失败策略

- 网络 / 401 / 429 / 400：记 `warning`，不阻断 Bot。
