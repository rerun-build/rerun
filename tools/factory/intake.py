import re

import ledger

MARKER = re.compile(r"^PLAN READY\b", re.M)


def parse_plan(text):
    text = (text or "").replace("\r\n", "\n")
    if not MARKER.search(text):
        return [], ["no PLAN READY marker"]
    lines = ledger.chunk_lines(text)
    if not lines:
        return [], ["no chunk lines under ## Chunks"]
    chunks, errors, seen = [], [], set()
    for line in lines:
        c = ledger.chunk(line)
        why = ledger.shape(line)
        if why:
            errors.append("%s: %s" % (c["id"], "; ".join(why)))
        elif c["id"] in seen:
            errors.append("%s: duplicate id" % c["id"])
        else:
            seen.add(c["id"])
            chunks.append(c)
    return chunks, errors


def register(st, job, meta, text):
    chunks, errors = parse_plan(text)
    if not chunks:
        return None, errors
    state = ledger.new(job)
    for k in ("repo_url", "title", "base_branch"):
        st.set(job, k, meta[k])
    for c in chunks:
        state["chunks"][c["id"]] = "PENDING"
        st.set(job, "test:" + c["id"], "%s %s" % (c["suite"], c["test"]))
        deps = [d for d in re.split(r"[\s,]+", c["depends"] or "") if d and d != "-"]
        st.add_ready(job, c["id"], c["paths"], c["builder"] or "", deps)
    st.enqueue(job, "challenge")
    return state, errors
