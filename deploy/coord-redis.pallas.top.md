# 联邦协调 Redis 公网（coord.pallas.top）

Bot 跨 deployment ingress 去重使用 **TCP Redis**（非 HTTP），须单独解析子域并放行端口。

## DNS（在 `pallas.top` 解析商控制台）

| 类型 | 主机记录 | 记录值 | 说明 |
| --- | --- | --- | --- |
| **A** | `coord` | 中心机公网 IP（与 `pallas.top` 相同） | 完整域名为 **`coord.pallas.top`** |

生效后自检：

```bash
dig +short coord.pallas.top A
redis-cli -h coord.pallas.top -p 6380 -a '<REDIS_COORD_PASSWORD>' --no-auth-warning ping
```

## 端口与安全组

| 项 | 值 |
| --- | --- |
| 公网端口 | **6380**（映射容器 6379） |
| 协议 | TCP |
| 云安全组 | 入站放行 `6380/tcp`（建议仅信任 IP 段；公网暴露务必设强密码） |
| 本机维护 | `127.0.0.1:6382` 同实例，仅供中心机本机调试 |

## 中心配置（`config/stats.toml` `[env]`）

```toml
FEDERATE_COORD_REDIS_URL = "redis://:<url-encoded-password>@coord.pallas.top:6380/2"
```

密码写在 `config/redis.coord.env`（`REDIS_COORD_PASSWORD`，勿提交 git）。`GET /v1/bootstrap` 的 `coord.redis_url` 与此一致。

## 与分片 Redis 的关系

- 分片仍用 Bot 本机 `REDIS_URL`（如 `127.0.0.1:6379/0`）。
- 联邦协调 Redis 使用 **db/2** 与 key 前缀 `pallas:fed:{federate_id}:`，可与分片共用同一 Redis **实例**但应用不同 URL/库号。
