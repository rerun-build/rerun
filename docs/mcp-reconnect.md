# MCP reconnect: what Reconnect does per provider

Facts read on dev at 9340e43 with the installed versions. Part of #41.

## Effect

`POST /agents/:id/mcp-servers/:name/reconnect` answers `effect`:

- `next_message` when the provider is `codex`, or when the pool did not hold the server (`reconnected` is `false`).
- `next_call` otherwise.

The `data-mcp-reconnect` part announced to the live runs carries the same `effect`.

## claude

`@anthropic-ai/claude-agent-sdk` 0.3.322 through `ai-sdk-provider-claude-code` 3.7.1.

- The run hands each pooled server to the SDK as an in-process `sdk` relay (`withPooledRelays`, `apps/engine/src/runtime/loop.ts:418`; `relayMcpServer`, `apps/engine/src/tools/mcp-relay.ts:10`).
- Reconnect closes the pooled client (`reconnectMcp`, `mcp-pool.ts:180`); the relay's next call dials again (`acquireMcp` `call`, `mcp-pool.ts:128` to :141). Effect: next call, same run.
- A server that did not join the pool at run start runs natively inside the SDK for that run (`claudeMcpConfig`, `apps/engine/src/agents/providers.ts:174`). The SDK has `Query.reconnectMcpServer(serverName)` (sdk.d.ts:3284) but the engine does not hold the `Query`, so Reconnect does not reach it. Effect: next message, when the next run tries the pool again.

## codex

`codex-cli` 0.166.0 through `ai-sdk-provider-codex-cli` 1.6.0, app-server transport.

- Servers are native entries of the app-server (`codexMcpConfig`, `providers.ts`). The app-server process is made per run (`resolveModel`, `providers.ts:394`, `close: () => codex.close()`).
- `codex mcp` offers list, get, add, remove, login, logout: no reconnect.
- Effect: next message, when the next run starts a fresh app-server and its servers.

## openrouter

Also every provider that is not a CLI (`CLI_PROVIDERS`, `apps/engine/src/agents/types.ts:9`).

- Tools come from the pool (`pooledMcpTools`, `mcp-pool.ts:151`), so the effect is next call, same run, as for claude.
- A server missing from the pool at run start has its tools left out of the run. Effect: next message.

## Automatic rule

A call that fails with a lost connection (`McpError` -32000, `EPIPE`, `ECONNRESET`) drops the connection, reconnects once and retries once before it fails (`mcp-pool.ts:134` to :140, log `mcp: connection lost, reconnecting once`).

## Run timeline

Reconnect writes a `data-mcp-reconnect` part to the agent's live runs (`agents.ts:193`), shown by `apps/ui/components/chat/McpReconnectBlock.tsx` from `MessageView.tsx:193`.
