import { computerHandleOf, parseComputerAccessDecision, parseHitlReply, pendingComputerAccess } from '@rerun/contracts'
import { extractText, listMessages } from '../db/repos/messages.js'
import { canonicalHitlName } from '../tools/builtin/hitl.js'
import type { RunContext } from '../runtime/context.js'

// What the person said yes to on a computer's card, read back from the conversation. Messages only
// reach the database when a run settles, so the history cannot change while this run uses its yes.

export type ComputerGrant = { computer: string; commands: Set<string>; paths: string[]; screen: boolean }

type StoredMessage = { role: string; contentJson: string }
type ContentPart = { type?: string; toolCallId?: string; toolName?: string; input?: unknown }

// The same command, whatever the spaces around and between its words.
export const normalizeCommand = (command: string): string => command.trim().replace(/\s+/g, ' ')

function parseContent(json: string): unknown {
    try {
        return JSON.parse(json)
    } catch {
        return null
    }
}

function accessRequestIn(content: unknown): ContentPart | null {
    if (!Array.isArray(content)) return null
    return (content as ContentPart[]).findLast(part => part?.type === 'tool-call' && !!part.toolCallId && canonicalHitlName(part.toolName) === 'request_computer_access') ?? null
}

const isHitlReply = (message: StoredMessage) => parseHitlReply(extractText(parseContent(message.contentJson))) !== null

// The yes of the latest card of the conversation, for the run that answer started and the cards that
// run raises after it: the next free message of the person is a new task, which asks again. A no, or a
// card not answered yet, grants nothing. A yes to the screen lasts the whole conversation.
export function findComputerGrants(messages: StoredMessage[]): ComputerGrant[] {
    const grants: ComputerGrant[] = []
    let latestSeen = false
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== 'assistant') continue
        const call = accessRequestIn(parseContent(messages[i].contentJson))
        if (!call) continue
        const [reply, ...afterReply] = messages.slice(i + 1).filter(message => message.role === 'user')
        const decision = reply ? parseComputerAccessDecision(extractText(parseContent(reply.contentJson))) : null
        const request = pendingComputerAccess((call.input ?? {}) as Record<string, unknown>)
        const isLatest = !latestSeen
        latestSeen = true
        if (decision?.decision !== 'approved' || decision.computer !== computerHandleOf(request.computer)) continue
        const current = isLatest && !afterReply.some(message => !isHitlReply(message))
        if (current) grants.push({ computer: request.computer, commands: new Set(request.commands.map(normalizeCommand)), paths: request.paths, screen: request.screen })
        else if (request.screen) grants.push({ computer: request.computer, commands: new Set(), paths: [], screen: true })
    }
    return grants
}

const grantsByRun = new WeakMap<RunContext, Promise<ComputerGrant[]>>()

// Read once per run. The person's reply is still on its way to the database when the run starts,
// hence the wait before the first read.
export function runGrants(ctx: RunContext): Promise<ComputerGrant[]> {
    let grants = grantsByRun.get(ctx)
    if (!grants) {
        grants = Promise.resolve(ctx.userTurnStored)
            .then(() => listMessages(ctx.agent.id, ctx.sessionId))
            .then(findComputerGrants)
        grantsByRun.set(ctx, grants)
    }
    return grants
}

export async function commandGranted(ctx: RunContext, computer: string, command: string): Promise<boolean> {
    const normalized = normalizeCommand(command)
    return (await runGrants(ctx)).some(grant => grant.computer === computer && grant.commands.has(normalized))
}
