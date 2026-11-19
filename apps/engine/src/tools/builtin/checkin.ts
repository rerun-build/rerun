import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { writeCheckinLog } from '../../checkins/log.js'
import type { RunContext } from '../../runtime/context.js'

export const REPORT_TITLE_MAX = 80

// The one thing a check-in may do beyond reading: decide to speak. The message is the final text of
// the run; this only says to whom and under which title, and the engine announces it once the run is
// over, as a thread of that member's conversation with the Chief of Staff.
export function reportToMemberTool(ctx: RunContext): ToolSet {
    return {
        report_to_member: tool({
            description: `Decide to speak to a person about what this check-in found, instead of keeping it to your log. Call it once, before your final message: that message is what they read, as a new thread of their conversation with you, with a notification. Write it for them, in their language: what you saw, why it matters to them, and the one next step you suggest, never something you did. End it with the replies they can send in one click to go ahead. Leave member out to speak to the workspace's owner, who also gets it when the member you name is kept to some Boxes.`,
            inputSchema: z.object({
                member: z.string().min(1).max(64).optional().describe('The id of the member it is for, from the list of people in the check-in message.'),
                about: z.array(z.string().min(1).max(64)).max(20).optional().describe('The ids of the coworkers it is about, as list_agents returned them.'),
                title: z.string().min(1).max(REPORT_TITLE_MAX).describe('The title of the thread, a few words in their language, e.g. "Your invoices coworker keeps failing".'),
            }),
            execute: async ({ member, about, title }) => {
                if (!ctx.runId) return 'Nothing to report from here.'
                await writeCheckinLog(ctx.runId, { reportedTo: member, about, title: title.trim() })
                return 'Noted. Now write the message itself as your final answer: it is what they will read.'
            },
        }),
    }
}
