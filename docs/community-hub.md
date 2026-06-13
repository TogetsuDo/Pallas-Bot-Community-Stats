# 社区中心主站（概览 + 牛牛气泡墙）

> 状态：P0/P1 已在 `feat/community-hub` 落地；P2（Bot opt-in 上报）待 Pallas-Bot 仓库  
> 公网入口：**`https://stats.pallasbot.top/`**（与现有 `/v1/*` API 同域）

## 目标

在 Community-Stats 主站提供**单页公开展示**：

1. **首屏**：社区概览（部署数、在线牛、语料、联邦等），数据来自现有 `GET /v1/monitor/overview`。
2. **向下滚动**：进入**全社区扁平一层**牛牛气泡墙——头像 + 昵称，气泡半径按消息量缩放，区分在线/离线。
3. **隐私**：不上报群号/消息正文；仅 opt-in 部署的名册进入气泡墙；公开 API 含 QQ 与资料卡链接供点击加好友。

## 页面结构

```
┌─────────────────────────────────────┐
│  sticky 顶栏 · 在线 X 套 / Y 牛      │
├─────────────────────────────────────┤
│  #overview  概览卡片网格              │
│  ↓ 向下查看在线牛牛                    │
├─────────────────────────────────────┤
│  #bubble    D3 pack 气泡墙（扁平）     │
├─────────────────────────────────────┤
│  页脚 · API 文档 · 隐私说明            │
└─────────────────────────────────────┘
```

| 行为 | 说明 |
| --- | --- |
| 首屏 | 请求 `/v1/monitor/overview`，概览先渲染 |
| 气泡区 | `IntersectionObserver` 进入视口后拉 `/v1/roster/bubble`，之后每 60s 刷新；**点击气泡**唤起 QQ 资料卡（`profile_url` deep link） |
| 窄屏 ≤560px | 概览卡片单列；气泡 pack 缩小，牛过多时允许横向滚动容器 |
| 空名册 | 气泡区文案 + WebUI opt-in 说明（Bot 侧 P2） |

## 路由与静态资源

| 路径 | 处理 |
| --- | --- |
| `/` | 社区主站 SPA（`index.html`） |
| `/assets/*` | Vite 构建产物 |
| `/v1/*` | 现有 FastAPI JSON API（不变） |
| `/health` | 健康检查（不变） |

实现：`web/` 源码 → `npm run build` → `src/pallas_community_stats/hub_static/`（Docker 多阶段构建写入镜像）。

## 数据：名册上报（扩展现有心跳）

各 Pallas 部署在 **opt-in** 时于 `POST /v1/heartbeat` 附带名册（Bot 侧 P2，默认关闭）：

```json
{
  "deployment_id": "550e8400-e29b-41d4-a716-446655440000",
  "online_bots": 2,
  "roster_public": true,
  "roster": [
    {
      "qq": 123456789,
      "nickname": "福牛一号",
      "online": true,
      "message_weight": 1280
    }
  ]
}
```

| 字段 | 约束 |
| --- | --- |
| `roster_public` | `false` 或未传：删除该 deployment 已存名册 |
| `roster` | 最多 256 条；`qq` 正整数；`nickname` ≤64 字符；`message_weight` 0–10_000_000 |
| `online` | 与 Bot `bot_status` 在线态一致 |

中心侧：

- 表 `roster_bots`：`(deployment_id, bot_key)` 为主键维度行。
- **`bot_key`** = `sha256("{qq}")` 小写 hex（全社区去重键，不含 deployment）。
- 同一 `bot_key` 多部署上报时，公开 API **合并**：`online`=任一为真，`message_weight`=各部署最大值，`nickname`=最近更新且非空者优先。

`roster_public=false` 或心跳不再带名册时，清除该 `deployment_id` 下所有行。

## 公开只读 API

### `GET /v1/roster/bubble`

无需鉴权。仅返回 opt-in 且所属 deployment 在 `online_ttl_sec` 内**有心跳**的牛（离线部署的名册不展示）。

**200**

```json
{
  "online_ttl_sec": 900,
  "as_of": "2026-06-14T12:00:00Z",
  "bots_total": 42,
  "bots_online": 31,
  "bots": [
    {
      "bot_key": "a1b2…",
      "qq": 123456789,
      "nickname": "福牛一号",
      "avatar_url": "https://q1.qlogo.cn/g?b=qq&nk=123456789&s=160",
      "profile_url": "tencent://ntqq-open?subCmd=profile&action=openMiniBuddyProfile&actionParams=…",
      "online": true,
      "message_weight": 1280
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `bots_total` | 返回列表长度 |
| `bots_online` | `online=true` 数量 |
| `avatar_url` | 中心根据 `qq` 生成 QQ 头像 URL |
| `profile_url` | NTQQ deep link，点击唤起资料卡 |
| `qq` | 牛牛 QQ 号（opt-in 名册即同意公开展示） |

`Cache-Control: public, max-age=60`（与前端轮询对齐）。

## 气泡可视化

- 库：**D3** `pack` 布局（扁平一层，无部署嵌套）。
- 半径：`r = rMin + k * sqrt(message_weight)`，权重为 0 时用 `rMin`。
- 在线：彩色描边 + 可选轻微 pulse；离线：`opacity` 降低 + 灰度滤镜。
- 标签：昵称 truncate；hover / tap 显示 nickname + 活跃度档位。
- **点击**：打开 `profile_url` 唤起 QQ 资料卡；无客户端时 fallback 复制 QQ 号。

## 实施分期

| 阶段 | 仓库 | 内容 |
| --- | --- | --- |
| **P0** | Community-Stats | 本文档、`web/` 单页、静态挂载、mock/空 bubble API |
| **P1** | Community-Stats | `roster_bots` 表、heartbeat 扩展、`GET /v1/roster/bubble`、测试、Docker 构建 |
| **P2** | Pallas-Bot | WebUI「社区名册公开」开关、`build_heartbeat_payload` 附带 roster、message_weight 统计 |
| **P3** | 文档 | `docs/API.md`、`client-integration.md`、README 主站说明；Docs 站链到主站 |

## Bot 侧（P2 概要，本仓库外）

- 配置键（示例）：`community_stats.roster_public` / `COMMUNITY_STATS_ROSTER_PUBLIC`。
- `message_weight`：近 7 天该牛处理消息数（或控制台已有计数），Hub 汇总后上报。
- 分片：仅 **hub** 上报 roster（与现有心跳一致，worker 不上报）。

## 运维

- Nginx 仍为 `location /` 全量反代至 `8099`，**无需**单独静态 location。
- 升级镜像后访问 `/` 即新版本；API 路径不变。
- 隐私：定期审计 roster 数据；日志不打 roster 正文。

## 相关

- [API.md](./API.md) — 心跳与 monitor（P1 后补充 roster 节）
- [client-integration.md](./client-integration.md) — Bot 心跳集成
- Pallas-Bot [community_stats](../Pallas-Bot/docs/common/community_stats.md) — 部署侧说明（P2 后更新）
