import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
    backups: { backups: [] as Array<{ connectionId: string; model: string }>, rerunCreditLastResort: false },
    latched: new Set<string>(),
    budgetLatched: false,
    connections: new Map<string, { id: string; usable: boolean; provider: string }>(),
    resetsAt: null as string | null,
}))

vi.mock('../connections/backups.js', () => ({ readBoxBackups: async () => state.backups }))
vi.mock('../connections/plan-limits.js', () => ({
    isPlanLimitLatched: (id: string) => state.latched.has(id),
    spentPlanWindow: () => (state.resetsAt ? { resetsAt: state.resetsAt } : null),
}))
vi.mock('../runtime/budget-latch.js', () => ({ isBudgetLatched: () => state.budgetLatched }))
vi.mock('../connections/registry.js', () => ({
    findConnection: async (id: string) => {
        const c = state.connections.get(id)
        return c ? { id: c.id, config: { provider: c.provider, name: c.id } } : null
    },
}))
vi.mock('./availability.js', () => ({
    isUsable: (connection: { id: string }) => state.connections.get(connection.id)?.usable ?? false,
    defaultModelOf: () => 'rerun-max',
    resolveRunModel: async () => null,
}))

const { pickBackup, switchOpeningTurn, limitReached } = await import('./backups.js')
const { forgetCredentialRejected, recordCredentialRejected } = await import('../connections/credential-rejections.js')

function connect(id: string, usable = true, provider = 'claude') {
    state.connections.set(id, { id, usable, provider })
}

const run = (id: string, model: string) => ({ connection: { id, config: { name: id } }, provider: 'claude', model }) as never

describe('pickBackup', () => {
    it('takes the first usable backup in order, past the tried, the latched and the unusable', async () => {
        for (const id of ['tried', 'latched', 'broken', 'ok', 'later']) connect(id, id !== 'broken')
        state.latched = new Set(['latched'])
        state.backups = { backups: ['tried', 'latched', 'broken', 'ok', 'later'].map(connectionId => ({ connectionId, model: 'm' })), rerunCreditLastResort: false }

        expect(await pickBackup(new Set(['tried']))).toMatchObject({ connection: { id: 'ok' }, model: 'm' })
    })

    it('skips a backup whose provider turned its key away, until it is renewed', async () => {
        for (const id of ['refused', 'ok']) connect(id)
        state.latched = new Set()
        state.backups = { backups: ['refused', 'ok'].map(connectionId => ({ connectionId, model: 'm' })), rerunCreditLastResort: false }

        recordCredentialRejected('refused')
        expect(await pickBackup(new Set())).toMatchObject({ connection: { id: 'ok' } })

        forgetCredentialRejected('refused')
        expect(await pickBackup(new Set())).toMatchObject({ connection: { id: 'refused' } })
    })

    it('falls back on the Rerun credit only when it is switched on and the budget is not spent', async () => {
        connect('rerun', true, 'rerun')
        state.latched = new Set()
        state.backups = { backups: [], rerunCreditLastResort: false }
        expect(await pickBackup(new Set())).toBeNull()

        state.backups = { backups: [], rerunCreditLastResort: true }
        expect(await pickBackup(new Set())).toMatchObject({ connection: { id: 'rerun' }, model: 'rerun-max' })

        state.budgetLatched = true
        expect(await pickBackup(new Set())).toBeNull()
        state.budgetLatched = false
    })
})

describe('switchOpeningTurn', () => {
    const primary = run('claude', 'opus')
    const backup = run('codex', 'gpt-6-sol')

    it('announces a turn sent to a backup, with the reset of the plan that ran out', () => {
        state.resetsAt = '2026-11-18T15:40:00.000Z'
        expect(switchOpeningTurn(primary, backup, null, true)).toMatchObject({ kind: 'switch', from: { connectionId: 'claude' }, to: { connectionId: 'codex' }, resetsAt: '2026-11-18T15:40:00.000Z' })
    })

    it('says nothing again while the conversation stays on the same backup', () => {
        const last = limitReached(primary, backup)
        expect(switchOpeningTurn(primary, backup, last, true)).toBeUndefined()
    })

    it('says it is back once the subscription it left serves the turn again', () => {
        const last = limitReached(primary, backup)
        expect(switchOpeningTurn(primary, primary, last, false)).toMatchObject({ kind: 'back', from: { connectionId: 'codex' }, to: { connectionId: 'claude' } })
        expect(switchOpeningTurn(primary, primary, { ...last, kind: 'back' }, false)).toBeUndefined()
        expect(switchOpeningTurn(primary, primary, null, false)).toBeUndefined()
    })

    it('says nothing while the subscription it left is still out and no backup is free', () => {
        const last = limitReached(primary, backup)
        expect(switchOpeningTurn(primary, primary, last, true)).toBeUndefined()
    })
})
