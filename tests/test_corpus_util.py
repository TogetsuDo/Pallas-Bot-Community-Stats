from pallas_community_stats.corpus_util import plain_message_text


def test_plain_message_text_strips_cq_segments() -> None:
    assert plain_message_text("你好[CQ:face,id=178]早上") == "你好早上"
    assert plain_message_text("[CQ:image,file=base64://abc]") == ""
    assert plain_message_text("  纯文本  ") == "纯文本"
