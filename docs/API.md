# HTTP API 约定

版本：**v1**（路径前缀 `/v1`）。Bot 客户端实现见 [client-integration.md](./client-integration.md)。

生产基址：**`https://stats.pallasbot.top`**（示例：`GET https://stats.pallasbot.top/v1/stats`）。服务可部署在任意 **`*.pallasbot.top`** 子域，中心配置 `CORPUS_PUBLIC_API_BASE` 与反代即可，Bot 以 enroll 返回的 `api_base` 为准。

## 术语

| 术语 | 含义 |
| --- | --- |
| **部署（deployment）** | 一户自托管 Pallas 安装，用 `deployment_id`（UUID v4）唯一标识 |
| **在线部署** | `last_seen` 在 `online_ttl_sec` 内的部署 |
| **在线牛总数** | 所有在线部署上报的 `online_bots` 之和（不是 QQ 去重数） |

## `GET /health`

存活探针，无需鉴权。

**200**

```json
{ "status": "ok" }
```

## `POST /v1/heartbeat`

上报或刷新一次部署心跳。同一 `deployment_id` 多次调用为更新，不增加 `deployments_total`。

### 鉴权

| 中心配置 | 行为 |
| --- | --- |
| `HEARTBEAT_TOKEN` **非空** | 须带 `Authorization: Bearer <token>` |
| `HEARTBEAT_TOKEN` **留空** | 不校验 Bearer，启用 **限流**（见下） |

公开自托管（如 `stats.pallasbot.top`）采用留空 + 限流；私有部署可自设 token 关闭公开写入。

**公开写入限流**（仅 token 留空时）：

- 单 IP：默认每分钟最多 `HEARTBEAT_RATE_PER_IP_PER_MIN` 次（默认 60）
- 单 `deployment_id`：默认最短间隔 `HEARTBEAT_MIN_INTERVAL_SEC` 秒（默认 30）

超限返回 **429**。

### 请求体（JSON）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `deployment_id` | string | 是 | UUID v4，小写存储 |
| `ts` | int | 否 | 客户端 Unix 秒；缺省用服务端时间。与服务器差超过 `MAX_CLOCK_SKEW_SEC` 则 400 |
| `version` | string | 否 | Bot 版本号，最长 64 字符 |
| `online_bots` | int | 否 | 当前在线 QQ 数，默认 0，上限 10000 |
| `catalog_bots` | int | 否 | 名册 QQ 数，默认 0 |
| `sharded` | bool | 否 | 是否分片部署 |
| `shard_workers` | int | 否 | worker 数量，0–256 |
| `roster_public` | bool | 否 | 是否公开本部署名册至社区气泡墙；默认 false |
| `roster` | array | 否 | opt-in 名册，最多 256 条；见下表 |

`roster` 元素：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `qq` | int | Bot QQ 号（中心侧存头像用，公开 API **不返回**） |
| `nickname` | string | 展示昵称，最长 64 字符 |
| `online` | bool | 是否在线 |
| `message_weight` | int | 活跃度权重（如近 7 天消息量），0–10_000_000 |

`roster_public=false` 或未传 `roster` 时，清除该 deployment 已存名册。

示例：

```json
{
  "deployment_id": "550e8400-e29b-41d4-a716-446655440000",
  "ts": 1716300000,
  "version": "3.0.0",
  "online_bots": 2,
  "catalog_bots": 3,
  "sharded": true,
  "shard_workers": 2
}
```

### 响应

**200**

```json
{
  "ok": true,
  "server_ts": 1716300001
}
```

### 错误

| 状态码 | 说明 |
| --- | --- |
| 400 | 校验失败（如非法 UUID、`ts` 偏差过大） |
| 401 | 缺少或错误的 Bearer token |

## `GET /v1/bootstrap`

向 Bot 下发联邦池身份与**协调 Redis**（跨 deployment ingress 去重用）。Bot **直连 Redis**，不经本服务转发群消息。

### 启用

中心须配置 `BOOTSTRAP_ENABLED=true`、`INSTANCE_SECRET`（非空）、`FEDERATE_ID`；协调 Redis 填 `FEDERATE_COORD_REDIS_URL`（可与中心限流 Redis 同实例、不同 DB/前缀）。

### 鉴权

| 配置 | 行为 |
| --- | --- |
| `BOOTSTRAP_ENABLED=false` | **503** `bootstrap disabled` |
| `INSTANCE_SECRET` 非空 | 须 `Authorization: Bearer <secret>` |
| `INSTANCE_SECRET` 留空且已启用 bootstrap | **503**（须先配置密钥） |

### 请求头

| 头 | 必填 | 说明 |
| --- | --- | --- |
| `X-Deployment-Id` | 是 | UUID v4，与心跳 `deployment_id` 一致 |

### 响应 200

```json
{
  "schema_version": 1,
  "deployment_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant_id": null,
  "federate_id": "public-pool",
  "coord": {
    "redis_url": "redis://redis.example:6379/2",
    "redis_prefix": "pallas:fed:public-pool",
    "claim_ttl_sec": 86400
  },
  "expires_at": 1735689600
}
```

| 字段 | 说明 |
| --- | --- |
| `federate_id` | 联邦池 ID；同池 deployment 共享 ingress 去重 |
| `coord.redis_url` | Bot 协调 Redis 连接串（须各 deployment 可达） |
| `coord.redis_prefix` | Redis key 前缀，默认可由中心按 `federate_id` 生成 |
| `coord.claim_ttl_sec` | ingress claim TTL（秒） |
| `expires_at` | 建议在此时间前重新拉取 bootstrap |

未配置 `FEDERATE_COORD_REDIS_URL` 时 `coord` 可为 `null`（仅下发 `federate_id`）。

### 错误

| 状态码 | 说明 |
| --- | --- |
| 400 | `X-Deployment-Id` 非法 |
| 401 | 缺少或错误的 Bearer |
| 503 | bootstrap 未启用或未配置密钥 |

## `GET /v1/federation/onboarding`

供 Bot 控制台「统计与语料」页展示的 **Phase 2 入池说明**（公开只读，无需鉴权）。

### 启用

默认在 `BOOTSTRAP_ENABLED=true` 且 `INSTANCE_SECRET` 非空时可用；可用 `FEDERATION_ONBOARDING_ENABLED=false` 关闭（**503**）。

| 环境变量 | 说明 |
| --- | --- |
| `FEDERATION_ONBOARDING_ENABLED` | 显式开/关；留空则随 bootstrap 配置推断 |
| `FEDERATION_ONBOARDING_PUBLISH_SECRET` | 默认 `true`；为 `false` 时不返回 `instance_secret`（仅步骤与池信息） |

### 响应 200

含 `title`、`summary`、`federate_id`、`coord`（协调 Redis **不含密码** 的展示 URL）、`pool_stats`（入池与 Redis 活跃部署计数，同 monitor `federation`）、`steps`（操作步骤）、`instance_secret`（入池密钥，与 bootstrap Bearer 相同）、`ingress_note` 等。

### 错误

| 状态码 | 说明 |
| --- | --- |
| 503 | 入池说明未启用 |

## `GET /v1/stats`

公开只读聚合指标，无需鉴权。

**200**

```json
{
  "deployments_total": 128,
  "deployments_online": 47,
  "bots_online_sum": 93,
  "deployments_online_sharded": 12,
  "shard_workers_online_sum": 84,
  "online_ttl_sec": 900,
  "as_of": "2026-05-22T12:00:00Z",
  "corpus": {
    "contexts_total": 120,
    "answers_total": 5400,
    "enrollments_total": 38,
    "contribute_enabled_total": 35
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `deployments_total` | 历史上报过的 `deployment_id` 去重数 |
| `deployments_online` | 在 TTL 内有心跳的部署数 |
| `bots_online_sum` | 上述在线部署的 `online_bots` 之和 |
| `deployments_online_sharded` | 在线部署中 `sharded=true` 的数量 |
| `shard_workers_online_sum` | 上述分片部署的 `shard_workers` 之和 |
| `online_ttl_sec` | 服务端当前在线判定窗口（秒） |
| `as_of` | 统计快照 UTC 时间（ISO-8601，`Z` 结尾） |
| `corpus` | 语料池公开计数（`CORPUS_ENABLED=false` 时为 `null`） |
| `federation` | 联邦入池计数（`BOOTSTRAP_ENABLED=false` 且无池配置时为 `null`） |
| `corpus.contexts_total` | 社区池 context 数 |
| `corpus.answers_total` | 社区池 answer 数 |
| `corpus.enrollments_total` | 已 enroll 的 deployment 数 |
| `corpus.contribute_enabled_total` | 允许 contribute 的 token 数 |

## `GET /v1/stats/corpus`

语料池专用监控指标（比 `/v1/stats` 的 `corpus` 嵌套字段更完整）。无需鉴权；`CORPUS_ENABLED=false` 时 **503**。

**200**

```json
{
  "online_ttl_sec": 900,
  "as_of": "2026-05-25T12:00:00Z",
  "corpus": {
    "contexts_total": 120,
    "answers_total": 5400,
    "answer_hits_sum": 12800,
    "enrollments_total": 38,
    "enrollments_online": 22,
    "enrollments_recent_24h": 3,
    "read_enabled_total": 38,
    "contribute_enabled_total": 35
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `enrollments_total` | 历史上 enroll 过的 deployment 数（与 token 表行数一致） |
| `enrollments_online` | 在 `online_ttl_sec` 内心跳的 deployment 中，已 enroll 的数量 |
| `enrollments_recent_24h` | 近 24 小时新 enroll 数 |
| `read_enabled_total` | 允许 read 的 token 数 |
| `answer_hits_sum` | 社区池 answer 行 `count` 字段合计（触发权重累计） |

## `GET /v1/monitor/overview`

控制台/WebUI 用的一页式监控快照：部署心跳 + 语料池 + 服务开关。无需鉴权。

**200**

```json
{
  "online_ttl_sec": 900,
  "as_of": "2026-05-25T12:00:00Z",
  "corpus_enabled": true,
  "deployments": {
    "deployments_total": 128,
    "deployments_online": 47,
    "bots_online_sum": 93,
    "catalog_bots_online_sum": 110,
    "deployments_online_sharded": 12,
    "shard_workers_online_sum": 84,
    "active_recent_24h": 52,
    "online_versions": [
      { "version": "3.1.0", "count": 18 },
      { "version": "3.0.2", "count": 9 }
    ]
  },
  "corpus": { "...": "同 /v1/stats/corpus 的 corpus 对象；corpus 关闭时为 null" },
  "federation": {
    "bootstrap_enabled": true,
    "federate_id": "pallas-public",
    "coord_redis_configured": true,
    "members_total": 12,
    "members_online": 5,
    "members_recent_24h": 2,
    "coord_active_deployments": 3
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `federation.members_total` | 累计入池：曾向中心 **成功领取** 联邦配置（`GET /v1/bootstrap`）的自托管套数 |
| `federation.members_online` | 在线入池：已入池且在 `online_ttl_sec` 内向中心 **上报过心跳**；与 Redis claim 无直接关系 |
| `federation.members_recent_24h` | 近 24 小时领取过 bootstrap 的 deployment 数 |
| `federation.coord_active_deployments` | 去重活跃：协调 Redis 上仍有 ingress **claim** 的 deployment 数（须实际处理群消息）；中心未配 Redis 或扫描失败时为 `null`；中心侧按 Redis URL + 前缀 **缓存 60 秒** |
| `deployments.catalog_bots_online_sum` | 在线部署上报的 `catalog_bots` 之和 |
| `deployments.active_recent_24h` | 近 24 小时有心跳的 deployment 数 |
| `deployments.online_versions` | 在线部署版本 Top 5（不含 deployment_id） |

## `GET /v1/badges/deployments-online`、`GET /v1/badges/bots-online`

供 [shields.io Endpoint Badge](https://shields.io/badges/endpoint-badge) 拉取（比 `dynamic/json` 更稳定）。无需鉴权；`Cache-Control: public, max-age=300`。

**200**（示例：`deployments-online`）

```json
{
  "schemaVersion": 1,
  "label": "社区部署",
  "message": "47 套在线",
  "color": "fe7d37"
}
```

`bots-online` 的 `message` 为在线牛总和的十进制字符串。

## `GET /v1/roster/bubble`

社区主站气泡墙只读数据。无需鉴权；`Cache-Control: public, max-age=60`。

仅包含 **opt-in**（`roster_public=true`）且所属 deployment 在 `online_ttl_sec` 内心跳的牛。同一 QQ 跨部署合并：`online` 取或，`message_weight` 取最大。

**200**

```json
{
  "online_ttl_sec": 900,
  "as_of": "2026-06-14T12:00:00Z",
  "bots_total": 2,
  "bots_online": 1,
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

页面入口：`GET /`（构建社区主站 SPA 后可用）。详见 [community-hub.md](./community-hub.md)。

## 语料 API（`/v1/corpus`）

与 Pallas-Bot `RemoteCorpusRepository` 对接。

| 用途 | 方法 / 路径 |
| --- | --- |
| 领取 token | `POST /v1/corpus/enroll` |
| 本部署用量 | `GET /v1/corpus/usage` |
| 读取语料 | `GET /v1/corpus/context?keywords=...` |
| 贡献语料 | `POST /v1/corpus/contribute` |

### `POST /v1/corpus/enroll`

公开实例默认无需 Bearer；`CORPUS_ENROLL_REQUIRES_HEARTBEAT_TOKEN=true` 时须心跳 token。

**请求：** `{ "deployment_id": "<uuid-v4>" }`

**200：** `corpus_token`（`pc_` 前缀）、`api_base`、`policy`、`expires_at`。同一 deployment 再次 enroll 会轮换 token。

### `GET /v1/corpus/usage`

**Headers：** `Authorization: Bearer pc_...`  
**200：** 按 `deployment_id` 累计（enroll 轮换 token 不重置计数）

| 字段 | 说明 |
| --- | --- |
| `read_lookups` | 向共享池发起的读取次数（含未命中 404） |
| `read_hits` | 共享池返回语料的次数（HTTP 200） |
| `contribute_ok` | 成功写入共享池的次数 |
| `updated_at` | 最近一次计数变更的 Unix 秒 |

### `GET /v1/corpus/hot`

公开只读：聚合共享池最热触发词及代表回复。无需鉴权；`CORPUS_ENABLED=false` 时路由不可用。

**Query：**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `pool` | `pool`：全量高频池；`recent`：按 `period` 窗口；`fleet`：近 24h 各站上报叠加（无代表回复） |
| `period` | `day` | `mode=recent` 时生效：`day` / `week` / `month` |
| `limit` | `40` | 5–80 |

**200**

```json
{
  "mode": "pool",
  "period": "day",
  "window_sec": 0,
  "as_of": "2026-06-14T00:00:00Z",
  "items": [
    {
      "keywords": "你好",
      "score": 12,
      "answers": [
        { "answer_keywords": "早啊", "message": "早啊", "count": 8 }
      ]
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `mode` | `pool` 或 `recent` |
| `window_sec` | `pool` 时为 `0`；`recent` 时为对应窗口秒数 |
| `score` | 统计范围内该触发词关联回复的 `count` 合计 |
| `answers` | 热度最高的若干代表回复（默认最多 3 条） |

`mode=fleet` 时 `answers` 为空数组，仅展示各部署近 24h 上报的热词叠加分；代表回复请结合 `mode=pool` 查看。

### 心跳热词快照（可选）

`POST /v1/heartbeat` body 可附带：

```json
{
  "corpus_hot_snapshot": {
    "as_of": 1700000000,
    "items": [{ "keywords": "你好", "score": 12 }]
  }
}
```

仅存触发词与计数，不含 QQ、群号与消息正文。用于 `mode=fleet` 机群叠加榜。

### `GET /v1/corpus/context`

**Headers：** `Authorization: Bearer pc_...`  
**Query：** `keywords`（必填）  
**200 / 404**（每次请求会计入 `read_lookups`；200 时另计 `read_hits`）

### `POST /v1/corpus/contribute`

须 token 且 `contribute` 权限（默认 enroll 为 `true`，可关）。

`op=upsert_answer`：`keywords`、`answer_keywords`、`message`、`group_id`（社区语料用 `0`）等。  
`op=insert`：完整 `context` 对象。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8099` | 监听端口 |
| `DB_PATH` | `data/stats.db` | SQLite 文件路径 |
| `HEARTBEAT_TOKEN` | 空 | 非空则强制 Bearer；留空为公开写入 + 限流 |
| `HEARTBEAT_RATE_PER_IP_PER_MIN` | `60` | 公开写入：单 IP 每分钟上限 |
| `HEARTBEAT_MIN_INTERVAL_SEC` | `30` | 公开写入：同一 deployment 最短间隔（秒） |
| `ONLINE_TTL_SEC` | `900` | 在线判定窗口（60–86400） |
| `MAX_CLOCK_SKEW_SEC` | `300` | 客户端 `ts` 允许偏差 |
| `CORPUS_ENABLED` | `true` | 是否挂载 `/v1/corpus/*` |
| `CORPUS_PUBLIC_API_BASE` | 空 | enroll 返回的 `api_base`；空则从请求推导 |
| `CORPUS_DEFAULT_CONTRIBUTE` | `true` | 新 enroll 默认是否允许 contribute |
| `CORPUS_ENROLL_REQUIRES_HEARTBEAT_TOKEN` | `false` | enroll 是否要求心跳 Bearer |
| `CORPUS_TOKEN_TTL_SEC` | `0` | token 有效期；0 表示不过期 |

## 隐私

默认心跳**不**接收 QQ 号列表、群号。仅当部署 **opt-in** `roster_public=true` 时，心跳可附带公开名册（`roster`）供气泡墙展示；公开 API 返回昵称、QQ 号与 `profile_url`（用于唤起 QQ 资料卡），不含群号与消息正文。语料 API 仅存匿名 `keywords` 与短句（`group_id=0`），不含 QQ/群号。
