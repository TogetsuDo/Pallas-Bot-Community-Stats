from __future__ import annotations

import hashlib


def bot_key_for_qq(qq: int) -> str:
    return hashlib.sha256(str(int(qq)).encode("ascii")).hexdigest()


def qq_avatar_url(qq: int) -> str:
    return f"https://q1.qlogo.cn/g?b=qq&nk={int(qq)}&s=160"
