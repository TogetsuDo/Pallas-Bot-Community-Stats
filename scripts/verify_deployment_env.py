#!/usr/bin/env python3
"""部署环境验证：镜像安装的依赖必须全部满足安全下限（含 redis extra）。

与 pytest 的分工：默认 `uv sync --group dev`（不含 redis extra）只由
`tests/test_deployment_lock_contract.py` 断言核心下限；本脚本用于部署场景，
在 CI 显式 `uv sync --group dev --extra redis` 后运行，对**全部**下限硬断言，
缺依赖即失败，不做静默跳过。

用法：uv run python scripts/verify_deployment_env.py
"""

from __future__ import annotations

import importlib.metadata
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))

from test_deployment_lock_contract import (  # noqa: E402
    CORE_FLOORS,
    REDIS_EXTRA_FLOORS,
    parse_version,
)


def main() -> int:
    floors = {**CORE_FLOORS, **REDIS_EXTRA_FLOORS}
    failures: list[str] = []
    for package, floor in floors.items():
        try:
            installed = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            failures.append(f"{package}: not installed (expected >={floor})")
            continue
        if parse_version(installed) < parse_version(floor):
            failures.append(f"{package}: {installed} < security floor {floor}")

    if failures:
        print("DEPLOYMENT ENV FAILED")
        for item in failures:
            print(f"  - {item}")
        return 1

    print(f"DEPLOYMENT ENV OK ({len(floors)} packages >= security floors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
