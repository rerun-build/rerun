import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import readyq

MAX_BATCH = 3


def pick_batch(ready, state, limit=MAX_BATCH):
    picked = []
    for c in ready:
        if len(picked) >= limit:
            break
        if picked and (c.get("builder") != picked[0].get("builder")
                       or any(readyq.overlap(c.get("paths", []), p.get("paths", [])) for p in picked)):
            continue
        if readyq.eligible(c, state)[0]:
            picked.append(c)
    return picked
