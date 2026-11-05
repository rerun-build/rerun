# OpenCode fixtures

- `go-models.json`, `console-models.json`: the public catalogs as `scripts/opencode-snapshot.mjs`
  last read them. The snapshot in `@rerun/contracts` is their parse.
- `*.sse`: one streamed answer per wire format, shaped on what the spike of 2026-11-04 recorded
  (`usage.opencode` on the last frame, `reasoning_content` on the chat deltas). They were written by
  hand, without a key: re-record them from the live suite when one is available.
