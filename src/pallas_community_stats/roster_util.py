from __future__ import annotations

import hashlib
import json


def bot_key_for_qq(qq: int) -> str:
    return hashlib.sha256(str(int(qq)).encode("ascii")).hexdigest()


def qq_avatar_url(qq: int) -> str:
    return f"https://q1.qlogo.cn/g?b=qq&nk={int(qq)}&s=160"


def qq_profile_deep_link(qq: int) -> str:
    """唤起 QQ 客户端资料卡（新版 NTQQ deep link）。"""
    params = json.dumps(
        {"uin": str(int(qq)), "sourceType": "QrCodeShareBuddyLink"},
        separators=(",", ":"),
    )
    return f"tencent://ntqq-open?subCmd=profile&action=openMiniBuddyProfile&actionParams={params}"
