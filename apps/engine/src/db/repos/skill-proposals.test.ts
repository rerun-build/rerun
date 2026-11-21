import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-proposal-repo-'))
process.env.RERUN_DATA_DIR = dataDir

const { describe, expect, it } = await import('vitest')
const { insertSkillProposal, transitionSkillProposal, getSkillProposal, openSkillProposalForSession, findSkillProposalByFingerprint } = await import('./skill-proposals.js')

const id = 'repo-agent'

let seq = 0
async function proposal() {
    seq += 1
    return insertSkillProposal(id, {
        sessionId: `session-${seq}`,
        runId: null,
        toolCallId: `call-${seq}`,
        mode: 'create',
        slug: null,
        title: 'Publishing checklist',
        summary: 'Always end a post with a CTA',
        instruction: 'Every post ends with a call to action.',
        fingerprint: `fp-${seq}`,
    })
}

describe('transitionSkillProposal', () => {
    it('lets exactly one of two concurrent clicks through', async () => {
        const row = await proposal()
        const [first, second] = await Promise.all([
            transitionSkillProposal(id, row.id, ['proposed'], 'accepted'),
            transitionSkillProposal(id, row.id, ['proposed'], 'accepted'),
        ])
        expect([first, second].filter(Boolean)).toHaveLength(1)
        expect((await getSkillProposal(id, row.id))?.status).toBe('accepted')
    })

    it('refuses a transition from a status that already moved on', async () => {
        const row = await proposal()
        await transitionSkillProposal(id, row.id, ['proposed'], 'dismissed')
        expect(await transitionSkillProposal(id, row.id, ['proposed'], 'accepted')).toBe(false)
    })

    it('takes a decided proposal out of the way of the next one', async () => {
        const row = await proposal()
        expect((await openSkillProposalForSession(id, row.sessionId))?.id).toBe(row.id)
        await transitionSkillProposal(id, row.id, ['proposed'], 'dismissed')
        expect(await openSkillProposalForSession(id, row.sessionId)).toBeUndefined()
    })
})

describe('findSkillProposalByFingerprint', () => {
    it('still matches a live proposal', async () => {
        const row = await proposal()
        expect((await findSkillProposalByFingerprint(id, `fp-${seq}`))?.id).toBe(row.id)
    })

    it('does not match a failed proposal, so the rule can be raised again', async () => {
        const row = await proposal()
        await transitionSkillProposal(id, row.id, ['proposed'], 'failed', { error: 'No object generated: could not parse the response.' })
        expect(await findSkillProposalByFingerprint(id, `fp-${seq}`)).toBeUndefined()
    })

    it('finds the live row when a failed row shares the fingerprint', async () => {
        const fingerprint = 'fp-shared'
        const failed = await insertSkillProposal(id, {
            sessionId: 'session-shared-failed',
            runId: null,
            toolCallId: 'call-shared-failed',
            mode: 'create',
            slug: null,
            title: 'Shared rule',
            summary: 'Shared',
            instruction: 'Every invoice is checked twice.',
            fingerprint,
        })
        await transitionSkillProposal(id, failed.id, ['proposed'], 'failed', { error: 'No object generated' })
        const live = await insertSkillProposal(id, {
            sessionId: 'session-shared-live',
            runId: null,
            toolCallId: 'call-shared-live',
            mode: 'create',
            slug: null,
            title: 'Shared rule',
            summary: 'Shared',
            instruction: 'Every invoice is checked twice.',
            fingerprint,
        })
        expect((await findSkillProposalByFingerprint(id, fingerprint))?.id).toBe(live.id)
    })
})
