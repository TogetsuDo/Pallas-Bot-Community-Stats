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
| `corpus.contexts_total` | 社区池 context 数 |
| `corpus.answers_total` | 社区池 answer 数 |
| `corpus.enrollments_total` | 已 enroll 的 deployment 数 |
| `corpus.contribute_enabled_total` | 允许 contribute 的 token 数 |

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

## 语料 API（`/v1/corpus`）

与 Pallas-Bot `RemoteCorpusRepository` 对接。

| 用途 | 方法 / 路径 |
| --- | --- |
| 领取 token | `POST /v1/corpus/enroll` |
| 读取语料 | `GET /v1/corpus/context?keywords=...` |
| 贡献语料 | `POST /v1/corpus/contribute` |

### `POST /v1/corpus/enroll`

公开实例默认无需 Bearer；`CORPUS_ENROLL_REQUIRES_HEARTBEAT_TOKEN=true` 时须心跳 token。

**请求：** `{ "deployment_id": "<uuid-v4>" }`

**200：** `corpus_token`（`pc_` 前缀）、`api_base`、`policy`、`expires_at`。同一 deployment 再次 enroll 会轮换 token。

### `GET /v1/corpus/context`

**Headers：** `Authorization: Bearer pc_...`  
**Query：** `keywords`（必填）  
**200 / 404**

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

心跳**不**接收 QQ 号列表、群号。语料 API 仅存匿名 `keywords` 与短句（`group_id=0`），不含 QQ/群号。
