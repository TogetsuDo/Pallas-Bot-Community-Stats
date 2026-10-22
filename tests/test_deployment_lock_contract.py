"""部署契约：镜像必须消费锁文件、不引入本地构建垃圾，且版本不低于线上安全下限。

回归背景（部署落差）：Dockerfile 原先执行 `uv pip install ".[redis]"`，从
pyproject 重新解析、完全忽略 uv.lock，导致此前的定向安全升级（Starlette 等）
从未进入镜像；CN Dockerfile 更是只装了 4 个直接依赖、缺 httpx / python-multipart
/ redis，模块启动即失败。

断言对象是构建产物（Dockerfile / Dockerfile.cn / .dockerignore / pyproject.toml /
uv.lock）与默认 dev 已安装的核心版本；不比对整份文件字符串，避免脆弱。
redis extra 的已安装下限由 `scripts/verify_deployment_env.py` 在部署场景硬断言。
"""

from __future__ import annotations

import importlib.metadata
import re
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# 已知线上 Stats 运行时版本（非降级下界）；certifi / pyjwt 取本轮目标修复线。
CORE_FLOORS: dict[str, str] = {
    "anyio": "4.15.1",
    "certifi": "2026.10.19",
    "fastapi": "0.141.1",
    "httpx": "0.28.1",
    "pydantic": "2.13.5",
    "pydantic-settings": "2.15.0",
    "python-multipart": "0.0.32",
    "starlette": "1.6.0",
    "uvicorn": "0.52.4",
}

# 仅 redis extra 引入（默认 `uv sync --group dev` 不安装）。
REDIS_EXTRA_FLOORS: dict[str, str] = {
    "pyjwt": "2.15.1",
    "redis": "5.3.1",
}

PRODUCTION_FLOORS: dict[str, str] = {**CORE_FLOORS, **REDIS_EXTRA_FLOORS}

# 直接依赖须在 pyproject 显式声明的下限（uv 与 pip 共用）。
DIRECT_FLOORS: dict[str, str] = {
    "fastapi": "0.141.1",
    "httpx": "0.28.1",
    "pydantic": "2.13.5",
    "pydantic-settings": "2.15.0",
    "python-multipart": "0.0.32",
    "uvicorn": "0.52.4",
}

# 仅传递依赖：uv 经 [tool.uv].constraint-dependencies 表达下限。
TRANSITIVE_FLOORS: dict[str, str] = {
    "anyio": "4.15.1",
    "certifi": "2026.10.19",
    "pyjwt": "2.15.1",
    "starlette": "1.6.0",
}

# 两个 Dockerfile 的 Python 基座必须钉在 registry 已确认存在的补丁 tag。
PYTHON_BASE_IMAGE = "python:3.12.15-slim"
NODE_BASE_IMAGE = "node:22-slim"

# .dockerignore 必须排除的本地构建无用物。
DOCKERIGNORE_EXCLUDED = [
    "web/node_modules",
    "web/node_modules/react/index.js",
    "web/dist",
    "web/dist/index.html",
    ".venv",
    ".venv/bin/python",
    "data",
    "data/stats.db",
    ".git",
    ".git/config",
    ".slim",
    ".slim/worktrees/security-20261022/Dockerfile",
    "__pycache__",
    "src/pallas_community_stats/__pycache__",
    "src/pallas_community_stats/__main__.pyc",
]

# COPY 源必须不被误排（否则构建缺文件）。
DOCKERIGNORE_KEEP = [
    "web/package.json",
    "web/package-lock.json",
    "web/index.html",
    "web/vite.config.ts",
    "web/tailwind.config.ts",
    "web/postcss.config.js",
    "web/tsconfig.json",
    "web/src/App.tsx",
    "web/public/favicon.png",
    "pyproject.toml",
    "uv.lock",
    "README.md",
    "src/pallas_community_stats/__main__.py",
    "src/pallas_community_stats/app.py",
    "src/pallas_community_stats/hub_static/.gitkeep",
]


def parse_version(value: str) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in value.split("."):
        digits = ""
        for char in chunk:
            if not char.isdigit():
                break
            digits += char
        parts.append(int(digits or "0"))
    return tuple(parts)


def requirement_name(spec: str) -> str:
    match = re.match(r"\s*([A-Za-z0-9_.\-]+)", spec)
    assert match, spec
    return match.group(1).lower().replace("_", "-")


def load_pyproject() -> dict:
    return tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))


def load_lock_packages() -> dict[str, str]:
    data = tomllib.loads((REPO_ROOT / "uv.lock").read_text(encoding="utf-8"))
    return {pkg["name"].lower().replace("_", "-"): pkg["version"] for pkg in data["package"]}


def dockerfile_instructions(name: str) -> list[str]:
    """把 Dockerfile 折行拼接为逐条指令（不做整文件字符串比对）。"""
    raw = (REPO_ROOT / name).read_text(encoding="utf-8")
    instructions: list[str] = []
    buffer = ""
    for line in raw.splitlines():
        stripped = line.strip()
        if not buffer and (not stripped or stripped.startswith("#")):
            continue
        buffer = f"{buffer} {stripped}".strip()
        if buffer.endswith("\\"):
            buffer = buffer[:-1].rstrip()
            continue
        instructions.append(re.sub(r"\s+", " ", buffer))
        buffer = ""
    if buffer:
        instructions.append(re.sub(r"\s+", " ", buffer))
    return instructions


def dockerfile_froms(name: str) -> list[str]:
    return [i.split()[1] for i in dockerfile_instructions(name) if i.upper().startswith("FROM ")]


def dockerignore_regex(pattern: str) -> re.Pattern[str]:
    out = ["^"]
    i = 0
    while i < len(pattern):
        char = pattern[i]
        if char == "*":
            if pattern[i : i + 2] == "**":
                out.append(".*")
                i += 2
                if i < len(pattern) and pattern[i] == "/":
                    i += 1
                continue
            out.append("[^/]*")
        elif char == "?":
            out.append("[^/]")
        elif char == "[":
            end = pattern.find("]", i)
            if end == -1:
                out.append(re.escape(char))
            else:
                out.append(pattern[i : end + 1])
                i = end
        else:
            out.append(re.escape(char))
        i += 1
    out.append("$")
    return re.compile("".join(out))


def dockerignore_excludes(patterns: list[str], path: str) -> bool:
    """Docker .dockerignore 语义的简化实现：模式命中路径自身或任一祖先目录。"""
    parts = path.strip("/").split("/")
    candidates = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    excluded = False
    for raw in patterns:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negate = line.startswith("!")
        pat = (line[1:].strip() if negate else line).lstrip("/").rstrip("/")
        if not pat:
            continue
        if any(dockerignore_regex(pat).match(c) for c in candidates):
            excluded = not negate
    return excluded


def test_pyproject_declares_security_floors() -> None:
    data = load_pyproject()
    direct = {requirement_name(spec): spec for spec in data["project"]["dependencies"]}
    for package, floor in DIRECT_FLOORS.items():
        assert package in direct, f"{package} missing from [project].dependencies"
        assert f">={floor}" in direct[package], f"{package} floor {floor} not declared: {direct[package]}"

    redis_extra = data["project"]["optional-dependencies"]["redis"]
    redis_spec = next(spec for spec in redis_extra if requirement_name(spec) == "redis")
    assert ">=5.3.1" in redis_spec, redis_spec

    constraints = data.get("tool", {}).get("uv", {}).get("constraint-dependencies", [])
    constrained = {requirement_name(spec): spec for spec in constraints}
    for package, floor in TRANSITIVE_FLOORS.items():
        assert package in constrained, f"{package} missing from [tool.uv].constraint-dependencies"
        assert f">={floor}" in constrained[package], constrained[package]


def test_lock_versions_not_below_production_floors() -> None:
    locked = load_lock_packages()
    for package, floor in PRODUCTION_FLOORS.items():
        assert package in locked, f"{package} missing from uv.lock"
        assert parse_version(locked[package]) >= parse_version(floor), f"{package} {locked[package]} < floor {floor}"


def test_installed_core_versions_not_below_production_floors() -> None:
    """默认 dev（无 redis extra）必须满足核心下限。"""
    for package, floor in CORE_FLOORS.items():
        installed = importlib.metadata.version(package)
        assert parse_version(installed) >= parse_version(floor), f"{package} {installed} < floor {floor}"


def test_base_images_pinned_to_registry_verified_tags() -> None:
    for name in ("Dockerfile", "Dockerfile.cn"):
        froms = dockerfile_froms(name)
        assert PYTHON_BASE_IMAGE in froms, f"{name} must pin {PYTHON_BASE_IMAGE}: {froms}"
        assert "python:3.12-slim" not in froms, f"{name} still uses floating python:3.12-slim"
    node_froms = dockerfile_froms("Dockerfile")
    assert NODE_BASE_IMAGE in node_froms, f"Dockerfile must keep {NODE_BASE_IMAGE}: {node_froms}"


def test_dockerfile_consumes_lock_and_runs_locked_sync() -> None:
    instructions = dockerfile_instructions("Dockerfile")
    copies = [i for i in instructions if i.upper().startswith("COPY")]
    assert any(re.search(r"(^|\s)uv\.lock(\s|$)", i) for i in copies), "Dockerfile must COPY uv.lock into the image"

    sync_runs = [i for i in instructions if re.search(r"\buv sync\b", i)]
    assert sync_runs, "Dockerfile must install with `uv sync`"
    sync = " ".join(sync_runs)
    assert "--locked" in sync, "uv sync must use --locked so the image consumes uv.lock"
    assert "--extra redis" in sync, sync
    assert "--no-dev" in sync, sync
    assert "--no-editable" in sync, sync

    assert not any("uv pip install" in i for i in instructions), "Dockerfile must not fall back to un-locked install"

    path_exposed = any(re.search(r"PATH=[\"']?/app/\.venv/bin", i) for i in instructions)
    assert path_exposed, "container PATH must expose /app/.venv/bin"


def test_dockerfile_cn_consumes_lock_with_cn_index() -> None:
    instructions = dockerfile_instructions("Dockerfile.cn")
    joined = " ".join(instructions)

    copies = [i for i in instructions if i.upper().startswith("COPY")]
    assert any(re.search(r"(^|\s)uv\.lock(\s|$)", i) for i in copies), "Dockerfile.cn must COPY uv.lock"

    exports = [i for i in instructions if re.search(r"\buv export\b", i)]
    assert exports, "Dockerfile.cn must export the locked dependency graph"
    assert "--locked" in " ".join(exports), "uv export must use --locked"
    assert "--extra redis" in " ".join(exports), exports

    installs = [i for i in instructions if re.search(r"\buv pip install\b", i)]
    assert installs, "Dockerfile.cn must install the exported locked requirements"
    assert "--index-url" in " ".join(installs), "Dockerfile.cn must keep the CN index mirror"
    assert "PIP_INDEX" in joined, "Dockerfile.cn must keep the CN mirror design"


def test_dockerignore_excludes_local_build_junk_and_keeps_sources() -> None:
    path = REPO_ROOT / ".dockerignore"
    assert path.exists(), ".dockerignore is required so local node_modules/dist never shadow npm ci"
    patterns = path.read_text(encoding="utf-8").splitlines()

    for excluded in DOCKERIGNORE_EXCLUDED:
        assert dockerignore_excludes(patterns, excluded), f".dockerignore must exclude {excluded}"
    for kept in DOCKERIGNORE_KEEP:
        assert not dockerignore_excludes(patterns, kept), f".dockerignore must not exclude build source {kept}"
