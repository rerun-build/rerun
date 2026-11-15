# Factory control H9: where lossless trimming, handoff and smaller screenshots belong in the engine

Research for rerun #627 (cut of #618). Docs only, no code changed. Read on 2026-11-15 in the worktree of origin/dev at b739fd9a (the plan names 599634a; it is an ancestor of b739fd9a, checked with `git merge-base --is-ancestor`). Every fact below is marked verified (read in the file named, at the line given) or inference (my reading of what follows from it). Paths are relative to `apps/engine/src/`.

## Corrections to the plan's references

- verified: `runtime/loop.ts:157-177` is the type `StepLike` and the start of `recordStepTelemetry`, which only writes telemetry rows. It is not where a tool result enters a run. The entry points are in the next section.
- verified: `config.ts` is `runtime/compaction/config.ts`; `prune.ts` and `compact.ts` are in `runtime/compaction/`. The cited lines are right: `config.ts:1-2` (ratio 0.75, cap 150_000), `config.ts:6` (2_000 chars), `compact.ts:88` (`compactionThreshold`), `browser.ts:168` (`page.screenshot({ path, fullPage: true })`).
- verified: the engine has no `send_message` tool. A new user message reaches the engine through `http/routes/chat.ts` (`resolveSession` at line 17, `runAgent` at line 53) and `runtime/headless-run.ts:22`. "The next send_message" in the plan means a chat request.
- verified: `view_image`, named in `tools/builtin/computer.ts:31`, is not defined in the engine; `rg view_image` finds only that string and the system prompt. The engine's own image reader is `vision_analyze` in `tools/builtin/vision.ts:58`.

## Item 3: lossless trimming of a tool result

### What exists today

- How a result enters a run (verified). `runtime/loop.ts:455-` calls the AI SDK `streamText` with `tools` and no per-tool output limit; the SDK feeds each tool result back as a `tool-result` message part in the next step. `onStepFinish` (loop.ts:480) only records telemetry. The messages are written to the database in `settle` (loop.ts:282-285, `appendMessage` per `settlement.messages`), so the full result is stored and is what the model sees on the next step, whatever its size. No `toModelOutput` and no size wrapper exists (`rg toModelOutput` finds nothing in non-test code).
- Limits inside single tools (verified): `tools/builtin/shell.ts:44` and `:51` cut output at 50_000 characters with `.slice(0, 50_000)`; `tools/builtin/fsTools.ts:22` cuts a file read at 100_000 characters; `fsTools.ts:84` truncates search hits at a count. These cut by dropping the tail, and the model gets no handle to read the rest.
- Saved-whole pattern (verified): `tools/builtin/page-file.ts` saves a whole page under `.rerun/pages` (`PAGES_DIR`, line 6, 30 days, 200 MB cap) and the tool result says `Saved whole: .rerun/pages/...`; paid data is saved under `.rerun/paid-data/` and read with `paid_data_read`.
- Pruning (verified): `runtime/compaction/prune.ts` runs only inside compaction (`compact.ts:118`), only on messages before `tailStart`, and only on parts of type text, json or content whose size is over `COMPACTION_PRUNE_OUTPUT_CHAR_THRESHOLD` = 2_000 (`config.ts:6`, `prune.ts:22-25`). It replaces the part with `[pruned] <tool> output (~N chars) elided to save context`, adds a pointer only when `savedPointerOf` (prune.ts:27-33) finds a page or paid-data path, and marks a repeat of the same result as a duplicate (prune.ts:51-54). The pruned text is used for the summary input and the in-memory view; the stored rows are untouched (the checkpoint stores only the summary, `compact.ts:124`).
- Compaction's own view of results is lossy: `partToText` (compact.ts:30-42) cuts each tool call input and result to 1_000 characters before they are summarized. A diff or code in a result is therefore reduced by a model summary in the middle part. This is the case the plan forbids for new work.

### What is missing

- verified: nothing bounds a result at entry. A 49_000-character shell output or a 100_000-character file read goes into every later step in full until compaction (at the lower of 75% of the window and 150_000 tokens) prunes it.
- verified: a pruned result gets a pointer only for pages and paid data. Shell, file, db, MCP and other results become a bare marker with no way to get the text back.
- inference: there is no exact-range fetch for a tool result; `fs_read` reads a whole workspace file (fsTools.ts:22 shows no offset or length argument in the part read).

### Smallest change and where

- inference: a result wrapper at the tool level, in a new `tools/result-handle.ts`, applied where the tool set is assembled (the place `loop.ts:431` gets `tools` from `built`). When a result text is over a declared size (a constant next to `config.ts:6`, for example 20_000 characters), write the whole text to `.rerun/results/<runId>/<toolCallId>.txt` in the agent workspace (same mechanism and sandbox as `page-file.ts`), and return the first N and last N lines plus `Saved whole: <path>, lines 1-<total>`, so `prune.ts:29` style pointers work.
- inference: an exact-range read, as an optional `offset` and `length` (or line range) on the existing `fs_read` in `tools/builtin/fsTools.ts`, so the model fetches exact lines and never a summary.
- inference: the rule "code or a diff is never replaced by a summary" is met by construction: the wrapper only cuts the middle and keeps the whole text on disk; it applies to every tool result of text type, and the wrapper must not run on results that the model must read whole (the handoff file, small results below the size).
- inference: `prune.ts` should also use the handle path as its pointer (extend `savedPointerOf`) so a pruned old result of any tool says where the whole text is.

### The test that would prove it

- inference: a unit test in `tools/result-handle.test.ts`: a 100_000-character result becomes head lines plus tail lines plus a path; the saved file equals the original byte for byte; a range read of lines 400-420 returns exactly those lines; a result under the size passes unchanged; a diff text is never altered inside the head and tail parts. A second case in `runtime/compaction/compaction.test.ts`: a pruned result carries the handle pointer.

### Risk to first-pass yield

- inference: medium. A model that needed the middle of a result and does not fetch it will fail a check it would have passed. Mitigation: a generous size (20_000 characters is about 5_000 tokens), the head and tail kept, the total line count shown, and the handle named in the text. Not measured: how often a worker needs the middle of a big result (no run data was read).

## Item 5: a written handoff instead of compaction

### What exists today

- verified: `compactionThreshold` (`runtime/compaction/compact.ts:88-91`) is 75% of the context window, capped at 150_000 tokens (`config.ts:1-2`) except for CLI providers (`CLI_PROVIDERS`), which take 75% with no cap. The token count is `estimateTokens` (estimate.ts:23), characters divided by `COMPACTION_CHARS_PER_TOKEN` = 4 (config.ts:5), plus the tool schema size (`toolPayloadChars`, tools/payload.ts); images are not counted by a separate rule (`partText`, estimate.ts:5-14, takes the text or the JSON of the part).
- verified: `prepareRunHistory` (compact.ts:93-135) runs at the start of every run, not mid-run. Over the threshold it keeps a tail of `COMPACTION_TAIL_TOKEN_BUDGET` = 20_000 tokens (`split.ts` `tailStartIndex`), prunes results (item 3), asks the same model to write a summary of the middle with `SUMMARY_SYSTEM` (compact.ts:25-26, sections Historical Task Snapshot, Completed Actions, Blocked / Open Issues, Pending User Asks, at most 12_000 tokens, temperature 0), saves a checkpoint (`db/repos/checkpoints.ts`), and returns `[summary, ...tail]`. The summary is wrapped as a `user` message with a preamble saying not to act on it (compact.ts:22-23, 122). A failure returns the full history (compact.ts:131-135).
- verified: a session is a stored message list plus the latest checkpoint; a new chat request without `sessionId` creates a fresh session (`http/routes/chat.ts:17-22`); `createSession` takes an optional `origin` (`db/repos/sessions.ts:7-9`), used by `tools/builtin/delegate.ts:82` and `call-agent.ts:86`.
- verified: the compaction summary is model-written from material cut to 1_000 characters per part (item 3), so file paths, ids and exact outputs can be lost.

### What is missing

- verified: no run ends with a written handoff and no session starts from one. `rg -i handoff` over non-test engine code finds only the word in `SUMMARY_SYSTEM`.
- inference: nothing records job, files touched, state and next step as structured data; they would have to be recovered from the tool call rows (`insertToolCall` in loop.ts:189, with `inputJson` and `resultJson`), which is data the engine already has.

### Smallest change and where

- inference: a handoff built from data, not from a summary model: a new `runtime/handoff.ts` that reads the session's `tool_calls` rows (job text = the first user message; files touched = paths in the inputs of the file and shell tools; state = last results; next step = the model's own last statement). Only the "next step" is written by the model, and it is requested as a final tool call (`write_handoff`, in `tools/builtin/`) that saves `.rerun/handoff/<sessionId>.md` in the workspace.
- inference: the start of a fresh session with it, in `http/routes/chat.ts` and `runtime/headless-run.ts`: when the stored estimate crosses the threshold, instead of calling `prepareRunHistory`'s summary, create a session with `origin` set (existing field) and put the handoff file text as the first user message. This is a policy switch next to `compactionThreshold` (compact.ts:88), off by default so existing sessions behave as today.
- inference: the same mechanism lets the factory runner (outside the engine) start a fresh worker on the file without any engine change; the engine change is only needed for chat sessions.

### The test that would prove it

- inference: `runtime/handoff.test.ts`: a fixture session with known tool calls yields a handoff that names every file the calls touched, the job, the last state and a next step, and a second run started from it sees that text as its first message and the earlier messages are absent. Existing `compaction.test.ts` and `compact.test.ts` must stay green with the switch off.

### Risk to first-pass yield

- inference: higher than item 3. A handoff written by the model can omit a fact; the data-built parts avoid that, but the "next step" is judgment. A cold start loses the cached prefix (the caching in loop.ts:451 `applyCaching` is keyed on the session), which raises cost on the first step. Not measured: how often compaction fires today, or what a summary loses (no run data read).

## Item 6: smaller screenshots

### What exists today

- Browser (verified): `tools/builtin/browser.ts:165-169` saves a full-page PNG at the workspace path the model gave, only when `screenshotPath` is passed (schema at browser.ts:204). Size is the page's own size at the launch viewport, no resize, no format change. The model sees it only by calling `vision_analyze` on that path (browser.ts:201 description).
- Reader for those files (verified): `tools/builtin/vision.ts:26-33` downscales to a longest edge of `VISION_MAX_EDGE` = 2048 and `VISION_MAX_BYTES` = 4 MB (webp quality 85), only when bigger. So a browser screenshot reaches the model at up to 2048 px on the long edge, and a long full-page capture is scaled to fit that edge.
- Computer (verified): `desktop/control.ts:5-6` sets `VIEW_MAX_WIDTH` = 1280 and `VIEW_MAX_HEIGHT` = 720; `control.ts:78` computes `scale = max(1, width/1280, height/720)`; `captureScreen` (control.ts:81-88) takes a PNG with the screen binary, resizes it to width/scale by height/scale and encodes JPEG at `JPEG_QUALITY` = 75 (control.ts:7). The tool returns `screen: [width, height]` (computer.ts:48, 203). The model therefore sees at most 1280x720 JPEG; coordinates are in that size and `onScreen` (control.ts:90-93) maps them back.
- Storage and delivery (verified): `computer.ts:153-163` keeps the screenshot in the per-run `ScreenshotStore` (`runtime/screenshots.ts:17-28`, at most `MAX_KEPT` = 6, cut to `KEPT_AFTER_EVICTION` = 3 when over) and returns `{ screenshotId }`, when the model sees images; otherwise it writes a `.jpg` in the workspace and returns `screenshotPath` with the `view_image` note (computer.ts:161-163, which points at a tool the engine does not define, see the corrections above). `stepWithScreenshots` (screenshots.ts:81-84, called from `prepareStep`, loop.ts:469-470) re-attaches every kept screenshot image to its result at each step, as a user message or in the tool result (screenshots.ts:45-79). Messages stored in the database carry only the id (the buffer is not stored), so a screenshot is not in the stored history after the run.
- inference: at each step, up to 6 JPEGs (each up to 1280x720) are resent, and each cannot be pruned by `prune.ts` because the pruner sees only the JSON with the id; the size cost is outside `estimateTokens`, which counts only the JSON text.

### What is missing

- verified: no declared size. 1280x720 and quality 75 are constants in `control.ts`; nothing in a run, agent config or tool input sets a smaller size. `captureScreen(control)` takes no size argument.
- verified: the browser screenshot is always full page when asked, with no scale or clip argument.
- inference: the count of kept images (6, down to 3) is a constant in `screenshots.ts:7-8`, not tied to the model or the task.

### Smallest change and where

- inference: a size profile read in one place, `desktop/control.ts`: `VIEW_MAX_WIDTH`, `VIEW_MAX_HEIGHT` and `JPEG_QUALITY` become values of a profile (`standard` = today's 1280x720 and 75; `small` = for example 800x450 and 60) chosen by a run option; the default stays `standard`. The profile comes in through `ScreenControl` (control.ts:58), which already carries `scale`; `captureScreen` and `onScreen` need no other change since coordinates follow `scale`.
- inference: the way to set it: an environment value read in `control.ts` for a whole engine, or an agent config field read where `computer.ts:153` builds the control. Default `standard`, so a run that checks a screen (the live check of #516) keeps today's size; the factory workers whose job is code turn `small` on. Rob's condition "except in a run that checks a screen" is met by the default, plus a rule that a run carrying the live-check label forces `standard`.
- inference: `browser.ts:168` gets an optional `fullPage` flag and an optional `maxEdge` input, with a resize through `sharp` as in `vision.ts:30-33`; default unchanged.
- inference: lowering `MAX_KEPT` for the small profile is a second, independent change in `screenshots.ts:7-8`.

### The test that would prove it

- inference: in `desktop/control.test.ts` (if present; not checked, see below) or `tools/builtin/computer.test.ts`: with the small profile on a 1920x1080 fake screen, the returned `screen` equals the small size and the buffer's metadata (through `sharp`) matches; with the default, the size is 1280x720 as today; a click at a coordinate maps to the right real pixel in both. In `runtime/screenshots.test.ts`, the store keeps the count the profile says.

### Risk to first-pass yield

- inference: low on code jobs, high on any screen check: small text is unreadable at a small size and a click can miss. This is why the default stays `standard` and a live check never uses `small`. Not measured: the token cost of an image per provider, and the size at which a worker's screen reading starts failing.

## Jobs to cut

Each is one pull request; `Files` are the allowed paths. "Engine tests" says whether it touches the engine's own tests.

1. Handle for large results (item 3). Files: `apps/engine/src/tools/result-handle.ts`, `apps/engine/src/tools/result-handle.test.ts`, `apps/engine/src/runtime/loop.ts` (where the tool set is wrapped), `apps/engine/src/runtime/compaction/config.ts` (size constant). Engine tests: yes, new test file, and `compaction.test.ts` is read, not changed.
2. Exact-range read (item 3). Files: `apps/engine/src/tools/builtin/fsTools.ts`, `apps/engine/src/tools/builtin/fsTools.test.ts`. Engine tests: yes (extends an existing test file). Depends on job 1 only for the path naming.
3. Pointer for every pruned result (item 3). Files: `apps/engine/src/runtime/compaction/prune.ts`, `apps/engine/src/runtime/compaction/compaction.test.ts`. Engine tests: yes. Depends on job 1.
4. Data-built handoff and `write_handoff` tool (item 5). Files: `apps/engine/src/runtime/handoff.ts`, `apps/engine/src/runtime/handoff.test.ts`, `apps/engine/src/tools/builtin/handoff.ts`, `apps/engine/src/tools/catalog.ts`. Engine tests: yes, new test file; `catalog.families.test.ts` and `catalog.cards.test.ts` are likely to need a line each (not checked).
5. Fresh session from a handoff, switch off by default (item 5). Files: `apps/engine/src/http/routes/chat.ts`, `apps/engine/src/runtime/headless-run.ts`, `apps/engine/src/runtime/compaction/compact.ts`. Engine tests: yes, `compact.test.ts` and a chat route test must stay green and gain a case. Depends on job 4.
6. Screenshot size profile (item 6). Files: `apps/engine/src/desktop/control.ts`, `apps/engine/src/tools/builtin/computer.ts`, `apps/engine/src/tools/builtin/computer.test.ts`. Engine tests: yes, `computer.test.ts`.
7. Browser screenshot size and kept-count (item 6). Files: `apps/engine/src/tools/builtin/browser.ts`, `apps/engine/src/tools/builtin/browser.test.ts`, `apps/engine/src/runtime/screenshots.ts`, `apps/engine/src/runtime/screenshots.test.ts`. Engine tests: yes.
8. Fix the `view_image` pointer in the computer tool note (found while reading). Files: `apps/engine/src/tools/builtin/computer.ts`, `apps/engine/src/tools/builtin/computer.test.ts`. Engine tests: yes. Whether the tool exists outside the engine (a bridge) was not checked; check before cutting.

All eight touch the engine's own tests; none is a docs-only job.

## Not checked

- Provider-side token cost of an image and of the cached prefix; no provider documentation was read.
- Any real run data: how large results are in practice, how often compaction fires, how often a worker reads the middle of a result.
- Whether `desktop/control.test.ts` exists, whether the live check of #516 has a label the engine can see, and whether `view_image` exists in a bridge outside `apps/engine`.
- `chat.ts` beyond lines 6-53, `headless-run.ts` beyond line 22, `split.ts`, `repair.ts` and the MCP and `shell`/`fsTools` tools beyond the lines cited.
- The `CLI_PROVIDERS` path (providers that run their own loop): whether result wrapping applies to tools run inside such a CLI was not read.
