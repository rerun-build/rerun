# Timers outside tests
as_of 2026-11-15, dev 4296d1f

Source: git grep for setTimeout(, setInterval(, waitForTimeout(, sleep(, delay( in apps/, packages/, tools/ (.ts .tsx .js .mjs .py .sh .kt), test, spec, __tests__, e2e, tests and fixtures paths left out. Read 2026-11-15. No code changed.

## Counts

Total sites: 249. kept: 242. no real reason: 7.

| Area | kept | no real reason | total |
|---|---|---|---|
| apps/desktop-app | 5 | 1 | 6 |
| apps/engine | 38 | 0 | 38 |
| apps/mobile | 42 | 2 | 44 |
| apps/ui | 117 | 4 | 121 |
| packages/analytics | 1 | 0 | 1 |
| packages/contracts | 3 | 0 | 3 |
| packages/ui | 28 | 0 | 28 |
| tools/factory | 8 | 0 | 8 |

## How a timer should be written

- Debounce: one shared debounce helper that cancels on unmount.
- Deadline: one deadline helper that aborts and clears its timer; nothing waits without it (FACTORY-CORE.md section 0a).
- Retry with back-off: one retry helper taking delays, jitter, a bound and an abort signal.
- Poll: one poll helper with an interval, a stop condition and a maximum, paused when the tab is hidden (useVisibleInterval exists in apps/ui/hooks).
- Animation frame or CSS-driven delay: requestAnimationFrame or transitionend, not a duration copied from CSS.
- The shared sleep is packages/contracts/src/sleep.ts; apps/ui and apps/engine also define their own copies.
- A delay that waits for nothing nameable is replaced by the event or promise it stands in for.

Helper names follow the Guards table in docs/research/2026-11-14-quality-pass/PLAN.md (inference: that table was not re-read for this file).

## Method and limits

Each site was read with 1 to 7 lines around it. The mark is verified where the code shows the reason, inference where the reason rests on a constant name or a guess. Rows that share a file and a pattern reuse one reason. Not checked: the PLAN.md Guards table text, the values of the constants, the CSS behind transition delays, whether any no real reason timer can go without breaking a test or a visual, and whether wider surroundings change a verdict. The 249 sites are the output of the command at 4296d1f; no .kt site matched.

## Table

| Site | Waits for | Verdict | Reason | Check |
|---|---|---|---|---|
| `apps/desktop-app/src/main/ipc-handlers.ts:88` | nothing nameable (50 ms before replacing the main window) | no real reason | waits for no event or promise; looks like a leftover race guard | inference |
| `apps/desktop-app/src/main/main-window.ts:252` | the ready-to-show event | kept | deadline: shows the window after 3 s if ready-to-show never fires | verified |
| `apps/desktop-app/src/main/updater.ts:61` | a poll of the update server | kept | first check after FIRST_CHECK_DELAY_MS then a poll every CHECK_EVERY_MS; no event exists for a new release | verified |
| `apps/desktop-app/src/main/updater.ts:62` | a poll of the update server | kept | first check after FIRST_CHECK_DELAY_MS then a poll every CHECK_EVERY_MS; no event exists for a new release | verified |
| `apps/desktop-app/src/main/window-state.ts:35` | user resize or move pause | kept | debounce 400 ms before saving window state | verified |
| `apps/desktop-app/src/renderer/src/offline.tsx:36` | a poll of the server | kept | poll every RETRY_EVERY_MS while offline, cleared on unmount, plus the online event | verified |
| `apps/engine/scripts/entrypoint-selftest-signals.sh:11` | nothing (keeps a test child alive) | kept | empty setInterval keeps the self-test child alive until it receives the signal under test | verified |
| `apps/engine/src/agents/claude-context.ts:27` | a usage read | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/agents/openrouter-stream-retry.ts:94` | a retry delay after a failed stream | kept | retry with back-off from retryDelaysMs, abortable by signal | verified |
| `apps/engine/src/agents/rerun-upstream.ts:24` | the first hub model read (FIRST_WAIT_MS) | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/cli/commands/run.ts:53` | MCP connections closing at shutdown (2 s grace) | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/connections/claude-token.ts:40` | a retry delay | kept | retry with back-off; throws once delays are used up | verified |
| `apps/engine/src/connections/codex-plan-limits.ts:51` | a codex plan-limits session | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/connections/plan-limits-pending.ts:14` | pending plan-limit reads | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/db/sqlStore.ts:57` | a busy database | kept | retry with jittered back-off on a busy error, bounded by RETRY_DELAYS | verified |
| `apps/engine/src/desktop/session.ts:86` | the VNC server being ready | kept | poll with a stop: loop bounded by timeoutMs | verified |
| `apps/engine/src/desktop/session.ts:108` | a child exiting after kill | kept | deadline: SIGKILL after KILL_GRACE_MS, cleared on exit | verified |
| `apps/engine/src/desktop/session.ts:218` | no viewers or holds | kept | idle timer that stops the desktop after IDLE_STOP_MS, unref-ed | verified |
| `apps/engine/src/desktop/takeover.ts:83` | takeover expiry | kept | deadline: expiry timer re-armed on activity | verified |
| `apps/engine/src/desktop/takeover.ts:90` | nobody watching the takeover | kept | poll with a stop: cleared when the takeover ends | verified |
| `apps/engine/src/memory/embed.ts:27` | an embedding fetch | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/pairing/pairing.ts:73` | a retry delay after pairing fails | kept | retry with back-off, logged with retryInMs | verified |
| `apps/engine/src/runtime/hub.ts:21` | a hub fetch | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/runtime/live-counter.ts:35` | a minimum flush interval | kept | throttle: waits only the rest of minIntervalMs since the last flush; cleared on dispose | verified |
| `apps/engine/src/runtime/loop.ts:252` | run teardown | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/runtime/notify.ts:74` | a notify fetch | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/runtime/run-stream-merge.ts:76` | a cut grace after a stream settles | kept | deadline: CUT_GRACE_MS bounds the wait for the other stream | verified |
| `apps/engine/src/runtime/run-streams.ts:33` | late subscribers after a run ends | kept | eviction timer: drops the buffer after EVICT_AFTER_MS | verified |
| `apps/engine/src/runtime/scheduler.ts:112` | the next scheduler tick | kept | poll of due schedules every TICK_MS, stopped by the returned function | verified |
| `apps/engine/src/runtime/stream.ts:38` | an idle SSE connection | kept | keep-alive ping interval; cleared on stream end | verified |
| `apps/engine/src/tools/builtin/browser.ts:105` | a bot wall clearing by itself | kept | poll with a stop: bounded by polls count and wall state | verified |
| `apps/engine/src/tools/builtin/computer.ts:77` | the user releasing the screen | kept | deadline: remainingMs, aborted when released | verified |
| `apps/engine/src/tools/builtin/computer.ts:98` | a human to stop driving | kept | poll with a stop: bounded by HANDS_OFF_WAIT_MS | verified |
| `apps/engine/src/tools/builtin/computer.ts:137` | the wait action of the computer tool | kept | the tool action is a wait by definition, abortable by signal | verified |
| `apps/engine/src/tools/builtin/computer.ts:201` | the screen to settle after an action (settleMs) | kept | nothing on the screen can be awaited; settle time is a parameter, abortable | inference |
| `apps/engine/src/tools/builtin/sub-run-watch.ts:108` | a sub-coworker run | kept | heartbeat interval and idle deadline, both unref-ed and cleared | verified |
| `apps/engine/src/tools/builtin/sub-run-watch.ts:164` | a sub-coworker run | kept | heartbeat interval and idle deadline, both unref-ed and cleared | verified |
| `apps/engine/src/tools/mcp-auth.ts:78` | the device-auth token poll | kept | poll with a stop: loop bounded by deadline, interval from the provider | verified |
| `apps/engine/src/tools/mcp-packages.ts:64` | an MCP package install | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/tools/mcp-pool.ts:42` | an idle MCP connection | kept | idle timer that closes the connection, re-armed while calls are in flight | verified |
| `apps/engine/src/tools/mcp-pool.ts:73` | an MCP connect | kept | deadline: MCP_CONNECT_TIMEOUT_MS | verified |
| `apps/engine/src/tools/mcp.ts:98` | an MCP probe | kept | deadline: bounds the wait (timeout or abort) | verified |
| `apps/engine/src/tools/virtual-display.ts:35` | an unused virtual display | kept | idle timer that stops Xvfb after IDLE_STOP_MS | verified |
| `apps/engine/src/tools/virtual-display.ts:64` | Xvfb start | kept | deadline: START_TIMEOUT_MS kills a start that never reports | verified |
| `apps/mobile/scripts/capture-store-shots.mjs:45` | the app to render before a screenshot | no real reason | fixed waits (LAUNCH_MS, SETTLE_MS, 1500, 2000) before screenshots wait for no named event; a screenshot could wait for a selector or text | inference |
| `apps/mobile/src/app/_layout.tsx:58` | a route to settle before navigating | kept | delayed push of the lead chat, cleared on unmount | inference |
| `apps/mobile/src/app/lab-consent.tsx:19` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab-delegate.tsx:34` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab-foreman.tsx:89` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab-markdown.tsx:213` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab-onboarding.tsx:28` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab-skill.tsx:50` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab-skill.tsx:53` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab-splash.tsx:44` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab-steps.tsx:22` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab.tsx:223` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/lab.tsx:224` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/app/search.tsx:38` | typing pause | kept | debounce before searching | verified |
| `apps/mobile/src/chat/useCoworkerChat.ts:155` | a grace period | kept | grace timer before treating the connection as lost | inference |
| `apps/mobile/src/chat/useSkillProposals.ts:69` | skill proposals | kept | poll with a stop: quick then relaxed interval, cleared on unmount; the third site is a dismissal timer | verified |
| `apps/mobile/src/chat/useSkillProposals.ts:71` | skill proposals | kept | poll with a stop: quick then relaxed interval, cleared on unmount; the third site is a dismissal timer | verified |
| `apps/mobile/src/chat/useSkillProposals.ts:87` | skill proposals | kept | poll with a stop: quick then relaxed interval, cleared on unmount; the third site is a dismissal timer | verified |
| `apps/mobile/src/components/auth/useSecondsSince.ts:6` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/mobile/src/components/chat/AuthoredGroup.tsx:52` | a user pause | kept | resets the named highlight after NAMED_FOR_MS | verified |
| `apps/mobile/src/components/chat/ForemanChat.tsx:199` | the server writing a title (TITLE_DELAY_MS 4000) | no real reason | reads the title once after a guessed delay; hides a race, a title event or a poll with a stop would name it | inference |
| `apps/mobile/src/components/chat/VoiceRecorderBar.tsx:40` | a recording | kept | poll of recorder state while recording; cleared when it stops | verified |
| `apps/mobile/src/components/chat/VoiceWaveform.tsx:72` | an animation frame | kept | frame timer for the waveform | verified |
| `apps/mobile/src/components/chat/markdown/CodeBlock.tsx:22` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/mobile/src/components/chat/origins/RunOrigins.tsx:94` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/mobile/src/components/chat/screen/ScreenLoader.tsx:45` | an animation frame | kept | frame timer for the loader, stopped when still | verified |
| `apps/mobile/src/components/chat/steps/useElapsed.ts:14` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/mobile/src/components/chat/useVoiceMessage.ts:96` | a recording | kept | poll of recorder metering while recording; cleared when it stops | verified |
| `apps/mobile/src/components/home/BootFill.tsx:41` | an animation | kept | animation: duration of the reveal | verified |
| `apps/mobile/src/components/home/BootFill.tsx:48` | an animation | kept | animation: duration of the reveal | verified |
| `apps/mobile/src/components/onboarding/useIntake.ts:39` | the industry decision | kept | deadline: INDUSTRY_WAIT_MS gives up and settles with null | verified |
| `apps/mobile/src/components/onboarding/useOnboardingRoute.ts:62` | the waitlist status | kept | poll of the waitlist every WAITLIST_POLL_MS while waiting, cleared | verified |
| `apps/mobile/src/components/providers/PlanSignIn.tsx:182` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/mobile/src/components/providers/PlanSignIn.tsx:203` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/mobile/src/components/providers/connect.tsx:162` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/mobile/src/components/providers/connect.tsx:169` | device sign-in approval | kept | poll with a stop: ends at pending.expiresAt | verified |
| `apps/mobile/src/components/ui/system-dialogs.android.tsx:104` | the keyboard opening | kept | KEYBOARD_DELAY_MS before focusing; no event for the dialog being shown on this platform | inference |
| `apps/mobile/src/config/server-connect.ts:57` | a lookup fetch | kept | deadline: LOOKUP_TIMEOUT_MS | verified |
| `apps/mobile/src/data/InboxProvider.tsx:38` | a burst of changes | kept | debounce: BURST_MS before reload | verified |
| `apps/mobile/src/data/local-cache.ts:65` | the end of the current task (0 ms) | kept | defers a file write off the render path; guarded by generation | inference |
| `apps/mobile/src/data/useBoard.ts:28` | a burst of changes | kept | debounce: BURST_MS before reload | verified |
| `apps/mobile/src/data/useLiveReload.ts:43` | a failed live connection | kept | retry with back-off: 1000*2^failures capped at MAX_RETRY_MS | verified |
| `apps/mobile/src/mocks/store.tsx:41` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/mobile/src/mocks/store.tsx:55` | a simulated answer or animation | kept | lab or mock screen: the delay simulates latency or an animation; there is no real call to wait on | verified |
| `apps/ui/app/(dashboard)/factory/page.tsx:33` | a poll of factory state | kept | poll every POLL_MS, cleared on unmount | verified |
| `apps/ui/app/api/_services/mcp-account.service.ts:224` | a run to finish | kept | poll with a stop: bounded by deadline | verified |
| `apps/ui/app/api/oauth/composio/callback/route.ts:75` | a connected account becoming ACTIVE | kept | poll with a stop: ACTIVE_POLL_ATTEMPTS | verified |
| `apps/ui/app/desktop-view/page.tsx:58` | a frame to paint | kept | frame timer that copies the canvas; cleared on unmount | inference |
| `apps/ui/cloud-oss/tasks.ts:57` | a wait of minutes | kept | the wait is the step of a background task; helper name waitMinutes | inference |
| `apps/ui/components/agent/AgentPanelLogs.tsx:123` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/agent/AgentPanelServices.tsx:128` | typing pause | kept | debounce 300 ms | verified |
| `apps/ui/components/agent/AgentPanelSettings.tsx:106` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/agent/AgentPanelSetup.tsx:61` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/agent/ModelPickerProviders.tsx:80` | pointer leaving a submenu | kept | debounce: SUBMENU_CLOSE_DELAY_MS before closing | verified |
| `apps/ui/components/agent/TriggerUrlField.tsx:37` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/auth/AppAuthBoard.tsx:70` | a scripted board focus | kept | animation timing: DWELL_MS between focus changes | verified |
| `apps/ui/components/auth/AppAuthBoard.tsx:72` | a scripted board focus | kept | animation timing: DWELL_MS between focus changes | verified |
| `apps/ui/components/auth/EmailCodeForm.tsx:87` | a resend cooldown | kept | countdown that stops at 0 | verified |
| `apps/ui/components/auth/PhoneCodeForm.tsx:111` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/auth/captcha/hcaptcha-widget.ts:88` | the captcha script | kept | deadline: scriptTimeoutMs | verified |
| `apps/ui/components/auth/captcha/turnstile-widget.ts:88` | the captcha challenge | kept | deadline: silentTimeoutMs | verified |
| `apps/ui/components/auth/useAnonymousSignUp.tsx:75` | sign-up completion | kept | deadline: SETTLE_TIMEOUT_MS races the action | verified |
| `apps/ui/components/auth/useStageScript.ts:83` | an animation frame | kept | frame scheduled to the next script frame, min 16 ms | verified |
| `apps/ui/components/builder/discoveries/DiscoveryCard.tsx:78` | a beam animation | kept | animation: ARRIVAL_BEAM_MS | verified |
| `apps/ui/components/builder/discoveries/useCompanyDiscoveries.ts:77` | company discoveries | kept | poll with a stop: EMPTY_READS_BEFORE_GIVING_UP and MAX_POLL_MS | verified |
| `apps/ui/components/builder/usePlanPreviewScene.ts:25` | a scene animation | kept | animation timing from landedAt | verified |
| `apps/ui/components/chat/AgentChat.tsx:641` | chat history after a run | kept | poll with a stop: 5 attempts, 600 ms apart, waiting for history to be saved | verified |
| `apps/ui/components/chat/AgentChat.tsx:694` | an upgrade resume | kept | deadline: RESUME_STALL_MS | verified |
| `apps/ui/components/chat/CopyAction.tsx:18` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/chat/TriggerPayloadBlock.tsx:110` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/chat/VoiceRecorderBar.tsx:34` | a recording | kept | poll of recorder state while recording; cleared when it stops | verified |
| `apps/ui/components/connections/plan-connect/ChatGptPlanSteps.tsx:161` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/connections/use-claude-oauth.ts:41` | a double open of the sign-in window | kept | lock: OPEN_LOCK_MS minimum so the open button cannot be clicked twice | verified |
| `apps/ui/components/connections/use-codex-device-auth.ts:53` | a double open of the sign-in window | kept | lock: OPEN_LOCK_MS minimum | verified |
| `apps/ui/components/connections/use-codex-device-auth.ts:79` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/connections/use-codex-device-auth.ts:84` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/connections/use-codex-device-auth.ts:92` | device sign-in approval | kept | poll with a stop: ends at pending.expiresAt | verified |
| `apps/ui/components/control-center/useConversationSearch.ts:17` | typing pause | kept | debounce before search | verified |
| `apps/ui/components/data/DataBrowser.tsx:118` | typing pause | kept | debounce 300 ms | verified |
| `apps/ui/components/deploy-update/DeployUpdateWatcher.tsx:77` | a new deploy | kept | poll every VERSION_CHECK_INTERVAL_MS plus a check on tab visibility | verified |
| `apps/ui/components/dialogs/LinkedinProDialog.tsx:64` | a connection status | kept | poll every POLL_MS and a slow or expiry deadline; the 1500 ms reload is a separate row | verified |
| `apps/ui/components/dialogs/LinkedinProDialog.tsx:73` | a connection status | kept | poll every POLL_MS and a slow or expiry deadline; the 1500 ms reload is a separate row | verified |
| `apps/ui/components/dialogs/LinkedinProDialog.tsx:170` | nothing nameable (1500 ms before a second reload) | no real reason | reloads right away and again after 1.5 s to catch a server update with no event; a poll with a stop or an event would name it | inference |
| `apps/ui/components/dialogs/ServersDialog.tsx:173` | server status | kept | poll every POLL_MS, cleared on unmount | verified |
| `apps/ui/components/dialogs/WhatsappProDialog.tsx:69` | a connection status | kept | poll every POLL_MS and a slow or expiry deadline; the 1500 ms reload is a separate row | verified |
| `apps/ui/components/dialogs/WhatsappProDialog.tsx:92` | a connection status | kept | poll every POLL_MS and a slow or expiry deadline; the 1500 ms reload is a separate row | verified |
| `apps/ui/components/dialogs/WhatsappProDialog.tsx:195` | nothing nameable (1500 ms before a second reload) | no real reason | same pattern as LinkedinProDialog.tsx:170 | inference |
| `apps/ui/components/dialogs/new-box/NamePlaceholder.tsx:38` | a typing animation | kept | animation timing | verified |
| `apps/ui/components/dialogs/new-box/NamePlaceholder.tsx:80` | a typing animation | kept | animation timing | verified |
| `apps/ui/components/factory/FactoryInspector.tsx:42` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/factory/FactoryLoader.tsx:45` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/factory/FactoryTasks.tsx:44` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/factory/FactoryTopBar.tsx:47` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/factory/FactoryWorld.tsx:36` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/factory/FactoryWorld.tsx:47` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/foreman/ForemanColumn.tsx:300` | a CSS transition | kept | CSS-driven delay: TRANSITION_MS+20 releases the board cover, with cleanup | verified |
| `apps/ui/components/foreman/ForemanRoutines.tsx:27` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `apps/ui/components/foreman/ForemanRoutines.tsx:65` | a run settling | kept | RUN_SETTLE_MS before reloading routines after a run | inference |
| `apps/ui/components/foreman/dock/ForemanPillField.tsx:43` | a textarea growing | kept | GROW_MS animation before moving the caret | verified |
| `apps/ui/components/foreman/dock/usePushToTalk.ts:52` | a key hold | kept | long-press detection: the delay is the gesture | verified |
| `apps/ui/components/foreman/dock/useTypewriter.ts:15` | a typing animation | kept | animation timing | verified |
| `apps/ui/components/foreman/getting-started/GettingStartedPopover.tsx:54` | pointer leaving | kept | debounce before closing the popover | verified |
| `apps/ui/components/foreman/intake/useForemanIntake.ts:130` | typing pause | kept | debounce before analysing the text | verified |
| `apps/ui/components/foreman/useForemanChat.ts:284` | chat history after a run | kept | poll with a stop: bounded reconcile loop, 600 ms apart | verified |
| `apps/ui/components/foreman/useForemanScriptedSteps.ts:78` | a board render (RECENTER_DELAY_MS 400 ms) | no real reason | recentres the board after new cards render with a guessed delay; hides a race, a layout effect or store event would name it | inference |
| `apps/ui/components/foreman/useForemanTurnNotification.ts:43` | a turn notification | kept | delay before showing the browser notification | inference |
| `apps/ui/components/layout/HomeContent.tsx:104` | a loader shown too briefly | kept | minimum display time MIN_LOADER_MS, avoids a flash | inference |
| `apps/ui/components/layout/useSheetResize.ts:119` | the click that follows a drag release | kept | 0 ms: removes the click swallower after the browser click event | verified |
| `apps/ui/components/layout/useSheetResize.ts:125` | a CSS dismiss transition | kept | CSS-driven delay: DISMISS_HANDOFF_MS | verified |
| `apps/ui/components/published/ShareDialog.tsx:314` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/rewind/slides/OutroSlide.tsx:21` | a slide entering | kept | animation: confetti after 500 ms | verified |
| `apps/ui/components/rewind/useSettledValue.ts:9` | a settle delay | kept | delayed value reveal by delaySeconds, an animation step | verified |
| `apps/ui/components/settings/EmailPreferencesForm.tsx:48` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/components/ui/text-loop.tsx:22` | a text animation | kept | animation timing | verified |
| `apps/ui/hooks/useAgentContext.ts:33` | a failed context read | kept | retry with a stop: FAILED_READ_RETRIES | verified |
| `apps/ui/hooks/useAgentSchedulesSync.ts:60` | a run settling | kept | RUN_SETTLE_MS before sync, cleared on cleanup | inference |
| `apps/ui/hooks/useAgentThreads.ts:17` | a burst of changes | kept | debounce before reload | inference |
| `apps/ui/hooks/useAwaitedThumbnail.ts:22` | a thumbnail to appear | kept | poll with a stop: deadline | verified |
| `apps/ui/hooks/useBrainAutosave.ts:76` | typing pause | kept | debounce: DEBOUNCE_MS autosave | verified |
| `apps/ui/hooks/useBrainProposalCount.ts:18` | proposal count | kept | poll every POLL_MS and on tab visibility | verified |
| `apps/ui/hooks/useFileUploads.ts:103` | upload progress | kept | throttle of progress publishing | inference |
| `apps/ui/hooks/useFileUploads.ts:182` | a failed upload | kept | retry once after 1 s, bounded by job.attempt | verified |
| `apps/ui/hooks/useInboxAnnouncer.ts:38` | a notification display | kept | user pause: dwell before dismiss, held while hovered or paused | verified |
| `apps/ui/hooks/useNextRuns.ts:24` | the next run time | kept | timer to the soonest run, recomputed at least every RECOMPUTE_MS | verified |
| `apps/ui/hooks/useNextRuns.ts:26` | the next run time | kept | timer to the soonest run, recomputed at least every RECOMPUTE_MS | verified |
| `apps/ui/hooks/usePanelUploads.ts:37` | a burst of changes | kept | debounce before reload | inference |
| `apps/ui/hooks/usePopupClosePoll.ts:25` | a popup closing | kept | poll of popup.closed; no event exists for it, cleared when it closes | verified |
| `apps/ui/hooks/usePresenceHeartbeat.ts:32` | presence | kept | heartbeat every PRESENCE_HEARTBEAT_MS | verified |
| `apps/ui/hooks/useRunReconnect.ts:71` | a run to finish | kept | poll with a stop: RECONNECT_ATTEMPTS | verified |
| `apps/ui/hooks/useSkillProposals.ts:68` | skill proposals | kept | poll with a stop: quick then relaxed interval, cleared; the third site is a dismissal timer | verified |
| `apps/ui/hooks/useSkillProposals.ts:70` | skill proposals | kept | poll with a stop: quick then relaxed interval, cleared; the third site is a dismissal timer | verified |
| `apps/ui/hooks/useSkillProposals.ts:89` | skill proposals | kept | poll with a stop: quick then relaxed interval, cleared; the third site is a dismissal timer | verified |
| `apps/ui/hooks/useVisibleInterval.ts:14` | a visible tab | kept | the shared poll helper; paused when hidden | verified |
| `apps/ui/hooks/useVoiceRecorder.ts:156` | a recording | kept | sampling interval while recording; cleared when it stops | verified |
| `apps/ui/lib/agent-ideas/judge.ts:65` | a 429 or 5xx answer | kept | retry with back-off, bounded by MAX_ATTEMPTS | verified |
| `apps/ui/lib/camera-storage.ts:43` | a burst of writes | kept | throttle: THROTTLE_MS | verified |
| `apps/ui/lib/chat/start-chat.ts:13` | a failed chat start | kept | retry with delay | verified |
| `apps/ui/lib/company/explore/explore.ts:39` | an explore call | kept | deadline: gives up after ms | verified |
| `apps/ui/lib/company/firecrawl.ts:71` | a rate-limited call | kept | retry after RATE_LIMIT_RETRY_MS on 429 | verified |
| `apps/ui/lib/desktop-shell/service-sign-in.ts:32` | the sign-in return | kept | deadline for the shell oauth return | verified |
| `apps/ui/lib/email/throttle.ts:53` | a rate limit | kept | throttle: MIN_INTERVAL_MS slots and retry with back-off RETRY_DELAYS_MS on rate_limited | verified |
| `apps/ui/lib/email/throttle.ts:62` | a rate limit | kept | throttle: MIN_INTERVAL_MS slots and retry with back-off RETRY_DELAYS_MS on rate_limited | verified |
| `apps/ui/lib/foreman/build-once.ts:87` | a build to finish | kept | poll with a stop: deadline and abort signal | verified |
| `apps/ui/lib/foreman/sub-run-watch.ts:34` | a sub-coworker run | kept | heartbeat interval, unref-ed | verified |
| `apps/ui/lib/hairline/approve.js:82` | a pointer animation | kept | animation timing, reduced motion respected | verified |
| `apps/ui/lib/hairline/approve.js:84` | a pointer animation | kept | animation timing, reduced motion respected | verified |
| `apps/ui/lib/hairline/kernel.js:323` | the end of a failed tick | kept | rethrows the error outside the frame loop so it is reported and the loop survives | verified |
| `apps/ui/lib/hairline/kernel.js:424` | pointer leave | kept | debounce before on.leave | verified |
| `apps/ui/lib/notifications/browser.ts:81` | another tab claiming a notification | kept | CLAIM_HOLD_MS lock across tabs | verified |
| `apps/ui/lib/notifications/browser.ts:89` | another tab claiming a notification | kept | CLAIM_SETTLE_MS then check the claim: cross-tab arbitration has no event | verified |
| `apps/ui/lib/oauth/popup-result.ts:22` | the opener receiving a message | no real reason | closes the popup after 400 ms; postMessage is synchronous, so the close can follow immediately | inference |
| `apps/ui/lib/sandbox/useEnsureSandboxSpace.ts:47` | a failed ensure | kept | retry after RETRY_MS, cleared | verified |
| `apps/ui/lib/storage/private.ts:34` | a failed download | kept | retry with jittered back-off, bounded by DOWNLOAD_RETRY_DELAYS_MS | verified |
| `apps/ui/lib/use-copy.ts:21` | a user pause | kept | resets a copied or saved confirmation flag after a fixed display time | verified |
| `apps/ui/scripts/service-alternatives.ts:55` | a retryable failure | kept | retry with back-off, bounded by MAX_ATTEMPTS | verified |
| `apps/ui/stores/board.store.ts:798` | a placement highlight | kept | animation: clears justPlacedAgentId after a delay | verified |
| `apps/ui/stores/brain.store.ts:22` | a burst of changes | kept | debounce before applying | verified |
| `apps/ui/stores/discoveries.store.ts:27` | a drain schedule | kept | throttle: waits only the remaining time | verified |
| `apps/ui/supabase/session/signup-stamp.ts:3` | a signup stamp | kept | retry delays with abort signal | verified |
| `apps/ui/supabase/session/signup-stamp.ts:6` | a signup stamp | kept | retry delays with abort signal | verified |
| `apps/ui/supabase/session/signup-stamp.ts:18` | a signup stamp | kept | retry delays with abort signal | verified |
| `apps/ui/supabase/useRealtimeSubscription.ts:51` | a burst of events | kept | debounce 200 ms before resync | verified |
| `apps/ui/supabase/useRealtimeSubscription.ts:113` | a dropped channel | kept | reconnect delay (retry) | verified |
| `apps/ui/supabase/useTeamCursors.ts:77` | a dropped channel | kept | reconnect delay (retry) | verified |
| `apps/ui/supabase/useTeamCursors.ts:86` | stale cursors | kept | prune interval, cleared on unmount | verified |
| `packages/analytics/src/client.ts:170` | late browser extensions | kept | fallback deadline: runs after LATE_EXTENSIONS_FALLBACK_MS if the load event does not come | verified |
| `packages/contracts/src/affiliate.ts:98` | the affiliate script loading | kept | retry with a stop: every SIGNUP_RETRY_MS until giveUpAt | verified |
| `packages/contracts/src/sleep.ts:1` | nothing (the shared sleep helper) | kept | the one helper other code calls; the wait belongs to its callers | verified |
| `packages/contracts/src/sleep.ts:2` | nothing (the shared sleep helper) | kept | the one helper other code calls; the wait belongs to its callers | verified |
| `packages/ui/src/foreman/RoutineList.tsx:228` | the input to mount | kept | deferred focus after render | inference |
| `packages/ui/src/iso-grid/IsoGrid.tsx:435` | a settle animation | kept | animation: SETTLE_MS flag, cleared on unmount | verified |
| `packages/ui/src/iso-grid/IsoGrid.tsx:881` | a drop refusal display | kept | user pause: DROP_REFUSAL_MS display of the refusal | verified |
| `packages/ui/src/iso-grid/components/ContainerBlock.tsx:113` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/iso-grid/components/TileBuddy.tsx:170` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/iso-grid/components/TileStatusBubble.tsx:30` | an exit animation | kept | animation: EXIT_MS, 0 when reduced motion | verified |
| `packages/ui/src/iso-grid/components/TileToastBubble.tsx:32` | a toast display | kept | user pause: hold then exit animation, then expire callback | verified |
| `packages/ui/src/iso-grid/components/TileToastBubble.tsx:33` | a toast display | kept | user pause: hold then exit animation, then expire callback | verified |
| `packages/ui/src/iso-grid/hooks/useBoardOnHover.ts:27` | hover intent | kept | debounce: INTENT_DELAY before going live | verified |
| `packages/ui/src/iso-grid/hooks/useCountdownNow.ts:20` | a countdown display | kept | clock tick that stops when the target time is reached | verified |
| `packages/ui/src/iso-grid/hooks/useCountdownNow.ts:22` | a countdown display | kept | clock tick that stops when the target time is reached | verified |
| `packages/ui/src/iso-grid/hooks/useLivingBoard.ts:80` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/iso-grid/hooks/useLivingBoard.ts:86` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/iso-grid/hooks/useLivingBoard.ts:90` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/iso-grid/hooks/useTouchGestures.ts:85` | a touch hold | kept | long-press detection: the delay is the gesture | verified |
| `packages/ui/src/new-agent/useJobReading.ts:35` | typing pause | kept | debounce before reading the job text | verified |
| `packages/ui/src/new-agent/useNewAgentDraft.ts:26` | a job reading | kept | deadline: SETTLE_MS falls back to a default reading | verified |
| `packages/ui/src/primitives/card-stack.tsx:49` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/primitives/dot-loader.tsx:75` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/primitives/use-elapsed.ts:16` | a clock | kept | interval that re-renders a displayed clock or elapsed time; cleared on unmount | verified |
| `packages/ui/src/template-story/TemplateStoryBoard.tsx:94` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/template-story/useActionTicker.ts:14` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/template-story/useStoryClock.ts:23` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/tour/useTourBeat.ts:13` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/tour/useTourStage.ts:23` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/tour/useTourStage.ts:72` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/tour/useTourStage.ts:86` | animation timing | kept | animation or scripted-story timing, cleared on unmount | verified |
| `packages/ui/src/useTransientTransition.ts:25` | a CSS transition | kept | CSS-driven delay: releases after the transition duration plus RELEASE_SLACK_MS | verified |
| `tools/factory/dispatch.py:828` | the next dispatcher poll | kept | poll of the queue every poll_s; the loop is the daemon and has no stop but the process | inference |
| `tools/factory/factory.py:292` | a lock or CI result | kept | poll with a stop: lock wait bounded by LOCK_WAIT_S, CI wait bounded by end and QUEUE_LIMIT_S | verified |
| `tools/factory/factory.py:694` | a lock or CI result | kept | poll with a stop: lock wait bounded by LOCK_WAIT_S, CI wait bounded by end and QUEUE_LIMIT_S | verified |
| `tools/factory/realmodel.py:67` | a run to finish | kept | poll with a stop: bounded by WAIT_S | verified |
| `tools/factory/stub_model.py:79` | a stub holding a response | kept | deliberate hold in the stub model (stub-hold) for tests | verified |
| `tools/factory/testdispatch.py:87` | a CI run | kept | poll with a stop: bounded by FIND_S and RUN_S | verified |
| `tools/factory/testdispatch.py:90` | a CI run | kept | poll with a stop: bounded by FIND_S and RUN_S | verified |
| `tools/factory/trigger.py:171` | a probe run | kept | poll with a stop: bounded by end | verified |
