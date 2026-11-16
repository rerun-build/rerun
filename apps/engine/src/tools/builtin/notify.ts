import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { RunContext } from '../../runtime/context.js'
import { authorMetadata, sendNotification } from '../../runtime/notify.js'
import { wakeMetadata, wakeOrigin } from '../../runtime/run-events.js'

const MAX_MESSAGE_LENGTH = 16_000

export function notifyTools(ctx: RunContext): ToolSet {
    return {
        notify_user: tool({
            description:
                'Send the user something they must see out-of-band (they may not be watching this conversation): a result they have to review, a risk you spotted, a decision they should know about. It flags the conversation as unread until they acknowledge it, so reserve it for what genuinely deserves their attention and never use it for a running commentary on your work. Do NOT use it to announce that you finished or that something failed: the end of a run and its errors are notified automatically. This does NOT pause you and does NOT wait for a reply: it only delivers a message, then you keep going. When you need an answer, call ask_user; a go-ahead, request_approval; a service or a credential, suggest_service or request_secret.',
            inputSchema: z.object({
                message: z.string().max(MAX_MESSAGE_LENGTH).describe('The human-readable message to show the user.'),
                kind: z.enum(['info']).default('info').describe('Always info: this tool has exactly one purpose, asking the user to look at something.'),
                metadata: z.record(z.string(), z.any()).optional().describe('Optional structured context (e.g. a URL, a proposed action, options to choose from).'),
            }),
            execute: async ({ message, kind, metadata }) => {
                const res = await sendNotification({
                    kind,
                    agentId: ctx.agent.id,
                    sessionId: ctx.sessionId,
                    runId: ctx.runId ?? null,
                    message,
                    ...wakeOrigin(ctx.trigger),
                    metadata: metadata || ctx.author || ctx.trigger?.source === 'wake' ? { ...metadata, ...authorMetadata(ctx.author), ...wakeMetadata(ctx.trigger) } : null,
                })
                if (!res.delivered) return `Notification not delivered (${res.reason ?? 'unknown'}). Continue without it.`
                return 'Notification sent to the user.'
            },
        }),
    }
}
