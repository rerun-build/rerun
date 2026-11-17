import { tool, type LanguageModelMiddleware, type ToolSet } from 'ai'
import { z } from 'zod'
import { isRecord } from '@rerun/contracts'
import { loopToolNameFor } from '../runtime/tool-repair.js'
import { MCP_CALL_TOOL, MCP_SEARCH_TOOL, type McpCatalogEntry } from './mcp-search.js'

// A run that holds its MCP tools back sends the model one fixed list of tools, so that nothing a
// search finds moves the start of the prompt the provider caches. The model runs a held-back tool
// through `mcp_call`, and this is the only place that knows it: on the way in the call is renamed
// to the tool it names, so the loop, the stored conversation, the app and the statistics all see
// `linear_list_issues`; on the way out the conversation is put back the way the model wrote it.

type StreamPart = { type: string; id?: string; toolName?: string; input?: string }

type HeldCall = { toolName: string; args: Record<string, unknown> }

// Arguments come in the `arguments` object, sometimes as its JSON text, sometimes laid beside `tool`.
function argumentsOf(call: Record<string, unknown>): Record<string, unknown> {
    const { tool: _tool, arguments: given, ...beside } = call
    if (isRecord(given)) return given
    if (typeof given !== 'string') return beside
    try {
        const parsed: unknown = JSON.parse(given)
        return isRecord(parsed) ? parsed : beside
    } catch {
        return beside
    }
}

function heldCallOf(input: unknown, held: Record<string, McpCatalogEntry>): HeldCall | null {
    if (!isRecord(input) || typeof input.tool !== 'string') return null
    const asked = input.tool.trim()
    const toolName = Object.hasOwn(held, asked) ? asked : loopToolNameFor(asked, held)
    return toolName && Object.hasOwn(held, toolName) ? { toolName, args: argumentsOf(input) } : null
}

function parsedInput(input: string | undefined): unknown {
    try {
        return JSON.parse(input ?? '')
    } catch {
        return null
    }
}

export function mcpWireMiddleware(catalog: McpCatalogEntry[]): LanguageModelMiddleware {
    const held = Object.fromEntries(catalog.map(entry => [entry.name, entry]))
    const isHeld = (toolName: string) => Object.hasOwn(held, toolName)

    return {
        specificationVersion: 'v3',
        transformParams: async ({ params }) => ({
            ...params,
            prompt: params.prompt.map(message => {
                if (message.role === 'assistant') {
                    return {
                        ...message,
                        content: message.content.map(part => {
                            if (part.type === 'tool-call' && isHeld(part.toolName)) return { ...part, toolName: MCP_CALL_TOOL, input: { tool: part.toolName, arguments: part.input } }
                            return part.type === 'tool-result' && isHeld(part.toolName) ? { ...part, toolName: MCP_CALL_TOOL } : part
                        }),
                    }
                }
                if (message.role !== 'tool') return message
                return { ...message, content: message.content.map(part => (part.type === 'tool-result' && isHeld(part.toolName) ? { ...part, toolName: MCP_CALL_TOOL } : part)) }
            }),
        }),
        async wrapStream({ doStream }) {
            const result = await doStream()
            // The tool a call runs is only known once its input is whole, so its input is not streamed.
            const unstreamed = new Set<string>()
            return {
                ...result,
                stream: result.stream.pipeThrough(
                    new TransformStream<StreamPart, StreamPart>({
                        transform(part, controller) {
                            if (part.type === 'tool-input-start' && part.toolName === MCP_CALL_TOOL && part.id) {
                                unstreamed.add(part.id)
                                return
                            }
                            if ((part.type === 'tool-input-delta' || part.type === 'tool-input-end') && part.id && unstreamed.has(part.id)) return
                            const call = part.type === 'tool-call' && part.toolName === MCP_CALL_TOOL ? heldCallOf(parsedInput(part.input), held) : null
                            controller.enqueue(call ? { ...part, toolName: call.toolName, input: JSON.stringify(call.args) } : part)
                        },
                    }) as TransformStream,
                ),
            }
        },
    }
}

// Only reached by a call the middleware could not hand to a tool: the name is not one of the agent's.
export function mcpCallTool(): ToolSet {
    return {
        [MCP_CALL_TOOL]: tool({
            description: `Run a tool of your connected MCP servers. Give its exact name as ${MCP_SEARCH_TOOL} returned it, and its arguments as the input schema ${MCP_SEARCH_TOOL} returned for it describes them.`,
            inputSchema: z.object({
                tool: z.string().describe('Exact name of the tool, "<server>_<tool>".'),
                arguments: z.looseObject({}).optional().describe("The tool's arguments, following its input schema."),
            }),
            execute: async ({ tool: asked }) => ({ error: `No tool of your MCP servers is named "${asked}". Nothing was run. Call ${MCP_SEARCH_TOOL} to find the tool and its input schema.` }),
        }),
    }
}
