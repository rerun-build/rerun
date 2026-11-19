import { describe, expect, it } from 'vitest'

import { pushButtonsOf } from './push-buttons'

const waiting = (toolName: string, kind = 'approval') => ({ event: 'agent.notification', kind, message: 'Send the 12 emails?', metadata: { toolCallId: 'call-1', toolName } }) as never

describe('pushButtonsOf', () => {
    it('lets an approval and a spend be approved from the lock screen', () => {
        expect(pushButtonsOf(waiting('request_approval'), 'conv-1')).toEqual({ categoryId: 'rerun.approval', toolCallId: 'call-1' })
        expect(pushButtonsOf(waiting('mcp__rerun__request_spend'), 'conv-1')).toEqual({ categoryId: 'rerun.approval', toolCallId: 'call-1' })
    })

    it('lets a question be answered in a line of text', () => {
        expect(pushButtonsOf(waiting('ask_user', 'question'), 'conv-1')).toEqual({ categoryId: 'rerun.question', toolCallId: 'call-1' })
    })

    it('lets a finished run be answered', () => {
        expect(pushButtonsOf({ event: 'agent.message.completed', kind: 'done', message: 'Here is the list.' } as never, 'conv-1')).toEqual({ categoryId: 'rerun.reply' })
    })

    it('opens the app for a key, a computer, an error, and a run without a conversation', () => {
        expect(pushButtonsOf(waiting('request_secret', 'connector'), 'conv-1')).toBeNull()
        expect(pushButtonsOf(waiting('request_computer_access'), 'conv-1')).toBeNull()
        expect(pushButtonsOf({ event: 'agent.message.completed', kind: 'error', message: 'Failed' } as never, 'conv-1')).toBeNull()
        expect(pushButtonsOf(waiting('request_approval'), null)).toBeNull()
    })

    it('opens the app for a skill proposal, which names no card', () => {
        expect(pushButtonsOf({ event: 'agent.notification', kind: 'approval', message: 'Keep this skill?', metadata: { toolName: 'skill_propose', proposalId: 'p-1' } } as never, 'conv-1')).toBeNull()
    })
})
