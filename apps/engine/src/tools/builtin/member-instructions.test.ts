import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-member-instructions-'))

const { describe, expect, it } = await import('vitest')
const { FOREMAN_INSTRUCTIONS_MAX } = await import('@rerun/contracts')
const { readMemberInstructions, saveMemberInstructions } = await import('../../db/repos/members.js')
const { SAVE_INSTRUCTIONS_TOOL, memberInstructionsTools } = await import('./member-instructions.js')

type Ctx = Parameters<typeof memberInstructionsTools>[0]

function ctxOf(extra: Record<string, unknown> = {}, kind = 'foreman'): Ctx {
    return { agent: { id: kind === 'foreman' ? 'foreman' : 'sales', config: { kind } }, author: { id: 'u-ana', name: 'Ana' }, ...extra } as unknown as Ctx
}

function save(ctx: Ctx, instructions: string) {
    const saveTool = memberInstructionsTools(ctx)[SAVE_INSTRUCTIONS_TOOL] as unknown as { execute: (input: unknown, options: unknown) => Promise<unknown> }
    return saveTool.execute({ instructions }, { toolCallId: 'c', messages: [] })
}

describe('save_instructions', () => {
    it('writes the instructions of the person who wrote the turn, and clears them with an empty text', async () => {
        expect(await save(ctxOf(), "  Don't call me by my first name.  ")).toEqual({ ok: true, instructions: "Don't call me by my first name." })
        expect(await readMemberInstructions('u-ana')).toBe("Don't call me by my first name.")
        expect(await save(ctxOf(), '')).toEqual({ ok: true, instructions: null })
        expect(await readMemberInstructions('u-ana')).toBeNull()
    })

    it('refuses a text over the limit and keeps what was there', async () => {
        await saveMemberInstructions('u-ana', 'Be brief.')
        expect(await save(ctxOf(), 'a'.repeat(FOREMAN_INSTRUCTIONS_MAX + 1))).toMatchObject({ ok: false })
        expect(await readMemberInstructions('u-ana')).toBe('Be brief.')
    })

    it('is held only by the Chief of Staff, on a turn a person wrote to it', () => {
        expect(Object.keys(memberInstructionsTools(ctxOf()))).toEqual([SAVE_INSTRUCTIONS_TOOL])
        for (const ctx of [ctxOf({ author: undefined }), ctxOf({ called: true }), ctxOf({ readOnly: true }), ctxOf({ author: { id: 'u-ana', via: 'foreman' } }), ctxOf({}, 'coworker')]) {
            expect(memberInstructionsTools(ctx)).toEqual({})
        }
    })
})
