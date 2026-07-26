# 社区中心主站（概览 + 气泡墙 + 投稿墙）

公网入口：**`https://stats.pallasbot.top/`**（与 `/v1/*` API 同域）。

Bot 侧名册上报、社区投稿与隐私说明见 Pallas-Bot [在线统计与社区主站](https://github.com/PallasBot/Pallas-Bot/blob/main/docs/common/community_stats.md)。

## 目标

在 Community-Stats 主站提供**单页公开展示**：

1. **首屏**：在线牛牛气泡墙（头像 + 昵称，半径按消息量缩放，区分在线 / 离线）。
2. **向下滚动**：部署概览指标、语料热词、**社区投稿墙**。
3. **隐私**：不上报群号 / 消息正文；仅开启名册的部署进入气泡墙；QQ 与头像昵称可分开控制。投稿为维护者主动提交的公开展示内容。

## 页面结构

```
┌─────────────────────────────────────┐
│  sticky 顶栏 · 主题切换 · 在线摘要   │
├─────────────────────────────────────┤
│  Hero                                 │
├─────────────────────────────────────┤
│  #bubble    D3 pack 气泡墙（扁平）     │
├─────────────────────────────────────┤
│  概览指标条（部署 / 在线牛 / 语料…）   │
├─────────────────────────────────────┤
│  语料热词 · #gallery 社区投稿墙        │
├─────────────────────────────────────┤
│  页脚 · API 文档 · 隐私说明            │
└─────────────────────────────────────┘
```

| 行为 | 说明 |
| --- | --- |
| 气泡区 | 进入视口后拉 `/v1/roster/bubble`，之后按约 60s 刷新；开启 QQ 公开时可点开资料卡 |
| 概览 | `GET /v1/monitor/overview` |
| 热词 | `GET /v1/corpus/hot`（`pool` / `recent` / `fleet`） |
| 投稿墙 | 进入视口后拉 `GET /v1/gallery/posts`；文字卡轮换，无 Bot 身份的带图投稿按截图展示 |
| 窄屏 ≤560px | 指标与分区单列；气泡过多时可横向滚动 |

投稿由各部署在 Bot 控制台 **统计与语料 → 社区投稿** 提交（经 Bot 代理写中心），主站只读展示。

## 路由与静态资源

| 路径 | 处理 |
| --- | --- |
| `/` | 社区主站 SPA（`index.html`） |
| `/assets/*` | Vite 构建产物 |
| `/v1/*` | FastAPI JSON API（含 `/v1/gallery/*`） |
| `/health` | 健康检查 |

实现：`web/` 源码 → `./scripts/build_hub.sh` → `src/pallas_community_stats/hub_static/`（Docker 多阶段构建写入镜像）。投稿墙 UI：`web/src/components/GallerySection.tsx`。

## 数据：名册上报（扩展心跳）

各 Pallas 部署在开启名册后于 `POST /v1/heartbeat` 附带名册（Bot 默认开启头像昵称、关闭 QQ）：

```json
{
  "deployment_id": "550e8400-e29b-41d4-a716-446655440000",
  "online_bots": 2,
  "roster_public": true,
  "roster_show_qq": false,
  "roster_show_profile": true,
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
| `roster_public` | `false` 或未传名册：删除该 deployment 已存名册 |
| `roster_show_qq` / `roster_show_profile` | 部署级是否在公开 API 露出 QQ / 头像昵称 |
| `roster` | 最多 256 条；`qq` 正整数；`nickname` ≤64 字符；`message_weight` 0–10_000_000 |

中心侧：

- 表 `roster_bots`：`(deployment_id, bot_key)` 为主键维度行。
- **`bot_key`** = `sha256("{qq}")` 小写 hex（全社区去重键，不含 deployment）。
- 同一 `bot_key` 多部署上报时，公开 API **合并**：`online`=任一为真，`message_weight`=各部署最大值，展示字段按部署级开关合并。

## 公开只读 API

### `GET /v1/roster/bubble`

无需鉴权。仅返回 opt-in 且所属 deployment 在 `online_ttl_sec` 内**有心跳**的牛。

`qq`、`avatar_url`、`profile_url` 按部署的 `roster_show_qq` / `roster_show_profile` 决定是否返回（关闭 QQ 时 `qq` 可为 `null`，`profile_url` 为空）。

详见 [API.md](./API.md)。

### `GET /v1/gallery/posts`

无需鉴权。返回已发布投稿（可分页 `cursor`）。创建 / 删除需 `deployment_id`（或语料 / 心跳 Bearer），见 [API.md](./API.md) § 社区投稿。

## 气泡可视化

- 库：**D3** `pack` 布局（扁平一层，无部署嵌套）。
- 半径：随 `message_weight` 缩放；权重为 0 时用最小半径。
- 在线 / 离线有描边与透明度区分。
- 开启 QQ 公开时，点击可打开 `profile_url` 唤起 QQ 资料卡。

## 运维

- Nginx 仍为 `location /` 全量反代至服务端口，**无需**单独静态 location。
- 升级镜像后访问 `/` 即新版本；API 路径不变。
- 隐私：定期审计 roster 数据；日志不打 roster 正文。投稿媒体在 `GALLERY_MEDIA_DIR`（默认 `data/gallery`）。
- 关闭投稿墙：`GALLERY_ENABLED=false`（不挂载 `/v1/gallery` 写接口时按实现返回 503）。

## 相关

- [API.md](./API.md) — 心跳、monitor、bubble、语料、投稿
- [client-integration.md](./client-integration.md) — Bot 心跳与投稿代理
- Pallas-Bot [community_stats](https://github.com/PallasBot/Pallas-Bot/blob/main/docs/common/community_stats.md) — 部署侧说明
