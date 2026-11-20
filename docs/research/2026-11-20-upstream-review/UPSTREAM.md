# Upstream review: what we take from rerun-build/rerun

As of 2026-11-20. Moldwright split from rerun-build/rerun on 2026-11-13 (merge base `2bf98517`). By 2026-11-20 upstream `dev` had 373 new commits (2,201 files, +126,299 / -19,796). Rob: "all that is work someone else did, and we must be diligent to onboard what makes sense and discard the rest."

Method: a cheap model read all 373 commit subjects and short-listed candidates; each candidate was then checked against our code (does the file exist here, does the change apply, do we already have it) before a verdict. Anything taken comes over as our own reviewed pull request with its tests; nothing is merged wholesale.

## Taken: engine fixes (one pull request)

| Upstream | What it fixes |
|---|---|
| `90dbdfd3` | An OpenAI API account out of credits is read as spent quota, not a generic error |
| `5f89e333` | Our tools stay directly callable under Codex's code-mode-only catalog |
| `e85bd3c4` | A box short on disk frees what the updater owns before giving up |
| `127f6cc6` | A self-hosted install generates its own OAuth and unsubscribe secrets instead of shared defaults |
| `761f8d41` | A tool error reaches the model as the error, not as a schema mismatch it cannot act on |
| `a157fae0` | Claude plan usage is read from real runs (makes the factory's "plan week" hold more accurate) |
| `bd282f8a` | Every page of an MCP server's tool list is read; tools past the first page were missing |
| `26f7202c` (+ `6b6d5ae0` by hand) | A custom endpoint's payment refusal is shown as the provider's own refusal |
| `5fdadc6e` | A coworker whose MCP server needs sign-in is sent to the Connect card, not a dead end |

## Taken later, one at a time and measured (tokens)

| Upstream | What it does | Tie-in |
|---|---|---|
| `d61bf2a9` | Every tool result capped at 40,000 characters, the rest saved to a file | ideas 5 and 13 (`docs/research/2026-11-19-borrowed-ideas/IDEAS.md`); ported by hand, it does not apply cleanly |
| `280c8559` | A long run is compacted between two steps, and each summary's cost recorded | token spend per run |
| `6c5b5ea1` | The Claude CLI may compact a long turn, shown in the run | token spend per run |
| `23ef0cbf` | A turn carries on to a backup model when a subscription hits its limit | an alternative to idea 6 (step down near the weekly limit) |

## Product, later

`264d5bbb`, `8c43b875`, `3b8adb65`: refinements to loading MCP tools on demand (catalog and search, a heavy tool set on demand, a fixed tool list when tools are held back). We already have the base (`apps/engine/src/tools/mcp-search.ts`); they help product coworkers with many tools more than the factory, which barely calls MCP tools.

## Still to check

- `2a5376cc` (the Codex app-server goes down before a thread resumes): written against `ai-sdk-provider-codex-cli` 1.3.1 and its patch; we are on 1.6.0 with our own patch, so the fault may already be gone. Check before porting.
- `829483c1` (read the caller from the token in presence, flags and home): a speed change on the sign-in path; take only after a careful read of how the token is checked.

## Discarded, after checking

| Upstream | Why not |
|---|---|
| `3b9a44c4`, `6dda3bf5` (Vault and Composio) | We do not have the Vault feature (`apps/ui/lib/vault/` does not exist here) |
| `742a9cdd`, `5371f80b`, `49f459ed` (billing, lifetime plan) | The billing files they fix do not exist in our code |
| `8cf72a2d` (Next.js 16.4.6 for security fixes) | We are already on Next.js 16.4.6 |
| `e9b0ae8d` (refuse anonymous users, drop their purge) | Our app signs visitors in anonymously on purpose (`apps/ui/supabase/middleware.ts`) and keeps the purge; switching anonymous visitors off would be a product decision |

## Discarded by theme (about 290 commits)

Upstream's own product direction, not fixes we need: UI and Simple view (~69), mobile app (~44), Chief of Staff and foreman (~40), Vault (~35), docs and screenshots (~32), billing, lifetime plans and credits (~31), computers, desktop and Quick ask (~25), LinkedIn, WhatsApp and Shopify apps (~18), onboarding UI (~19), their Konductor flows (~12), Brain (~8), translations (~8), refactors and Rewind removal (~9).

## Next time

The comparison point is now upstream `dev` at `291aa19234`, the commit this review read. A later review starts from there: `git log --no-merges 291aa19234..upstream/dev`.
