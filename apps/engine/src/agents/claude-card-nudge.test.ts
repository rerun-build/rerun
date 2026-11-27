import { describe, expect, it } from 'vitest'
import { CARD_TAG_NUDGE, TOOL_CALL_TEXT_NUDGE, cardTagStopHook } from './claude-card-nudge.js'
import { withCardTagNudge } from './providers.js'
import { claudeContextCapture } from './claude-context.js'

// The Support coworker's message of 27 November (RER-404), shortened.
const WRITTEN_CALL = 'Compris, je te propose de la garder dans le skill de validation des réponses support.\n[Tool call: mcp__rerun__skill_propose({"mode":"edit","slug":"validation-des-reponses-support"})]\n\nVoici comment je l\'appliquerai.'

const stop = (last_assistant_message: string | undefined, stop_hook_active = false) => ({ hook_event_name: 'Stop', stop_hook_active, last_assistant_message })

describe('cardTagStopHook', () => {
    it('blocks the first Stop of a turn that ends on a card written as a tag', async () => {
        await expect(cardTagStopHook(stop('Which angle do you want?\n\n<ask_user>\n</ask_user>'))).resolves.toEqual({ decision: 'block', reason: CARD_TAG_NUDGE })
    })

    it('blocks the first Stop of a turn whose message holds a tool call written as text', async () => {
        await expect(cardTagStopHook(stop(WRITTEN_CALL))).resolves.toEqual({ decision: 'block', reason: TOOL_CALL_TEXT_NUDGE })
    })

    it('lets a turn end on a tool call quoted as inline code, or once its block was answered', async () => {
        await expect(cardTagStopHook(stop('A line like `[Tool call: ask_user({})]` runs nothing.'))).resolves.toEqual({ continue: true })
        await expect(cardTagStopHook(stop(WRITTEN_CALL, true))).resolves.toEqual({ continue: true })
    })

    it('lets the Stop that follows its own block end the turn, whatever the model wrote', async () => {
        await expect(cardTagStopHook(stop('<ask_user>\n</ask_user>', true))).resolves.toEqual({ continue: true })
    })

    it('lets a turn without a card tag end', async () => {
        await expect(cardTagStopHook(stop('Here are your 100 leads.'))).resolves.toEqual({ continue: true })
        await expect(cardTagStopHook(stop(undefined))).resolves.toEqual({ continue: true })
        await expect(cardTagStopHook({ hook_event_name: 'SubagentStop', last_assistant_message: '<ask_user>' })).resolves.toEqual({ continue: true })
        await expect(cardTagStopHook(stop('Never write `<ask_user>` in a message.'))).resolves.toEqual({ continue: true })
    })
})

describe('withCardTagNudge', () => {
    it('adds the nudge after the context capture Stop hook instead of replacing it', () => {
        const capture = claudeContextCapture()
        const hooks = withCardTagNudge(capture.settings.hooks)
        const stops = hooks.Stop ?? []
        expect(stops).toHaveLength(2)
        expect(stops[0]).toBe(capture.settings.hooks?.Stop?.[0])
        expect(stops[1]?.hooks).toEqual([cardTagStopHook])
    })

    it('stands alone when no other hook is set', () => {
        expect(withCardTagNudge(undefined)).toEqual({ Stop: [{ hooks: [cardTagStopHook] }] })
    })
})
