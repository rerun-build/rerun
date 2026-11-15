PACKET_CAP = 4096
HEAD = "\n## Failure tail (last output of the previous attempt)\n"


def _fit(text, room):
    return text.encode()[:max(room, 0)].decode("utf-8", "ignore")


def retry_packet(base, failure, cap=PACKET_CAP):
    head = base + HEAD
    room = cap - len(head.encode())
    if room <= 0:
        return _fit(base, cap)
    raw = (failure or "").rstrip().encode()
    if len(raw) > room:
        raw = raw[-room:]
        nl = raw.find(b"\n")
        raw = raw[nl + 1:] if 0 <= nl < len(raw) - 1 else raw
    return head + raw.decode("utf-8", "ignore")
