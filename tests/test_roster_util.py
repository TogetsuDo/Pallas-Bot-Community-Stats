from pallas_community_stats.roster_util import qq_profile_deep_link


def test_qq_profile_deep_link_uses_raw_json_action_params() -> None:
    url = qq_profile_deep_link(2387466426)
    assert url.startswith("tencent://ntqq-open?subCmd=profile&action=openMiniBuddyProfile&actionParams=")
    assert "%7B" not in url
    assert '"uin":"2387466426"' in url
    assert '"sourceType":"QrCodeShareBuddyLink"' in url
