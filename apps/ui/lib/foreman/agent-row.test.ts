import { describe, expect, it } from 'vitest'
import { fakeSupabase, writeMethodOf } from '@/test/supabase-fake'
import { ensureForemanAgentRow } from './agent-row'

describe('ensureForemanAgentRow', () => {
    it('reads the row the workspace already has, and writes nothing', async () => {
        const db = fakeSupabase(table => (table === 'agents' ? { data: { id: 'cos-1' } } : undefined))
        await expect(ensureForemanAgentRow(db.client, 7)).resolves.toBe('cos-1')
        expect(db.writes('agents')).toEqual([])
    })

    it('writes the row outside every Box, under its engine id', async () => {
        const db = fakeSupabase((table, calls) => (table !== 'agents' ? undefined : writeMethodOf(calls) ? { data: { id: 'cos-new' } } : { data: null }))
        await expect(ensureForemanAgentRow(db.client, 7)).resolves.toBe('cos-new')
        expect(db.writes('agents').map(write => write.payload)).toEqual([{ workspace_id: 7, kind: 'foreman', space_id: null, name: 'Chief of Staff', engine_agent_id: 'foreman' }])
    })

    it('writes it under the name the workspace gave its Chief of Staff', async () => {
        const db = fakeSupabase((table, calls) => {
            if (table === 'workspace_onboarding') return { data: { answers: { foreman: { name: ' Ada ' } } } }
            if (table !== 'agents') return undefined
            return writeMethodOf(calls) ? { data: { id: 'cos-new' } } : { data: null }
        })
        await ensureForemanAgentRow(db.client, 7)
        expect(db.writes('agents').map(write => (write.payload as { name: string }).name)).toEqual(['Ada'])
    })

    it('reads the row of the caller it raced with', async () => {
        let reads = 0
        const db = fakeSupabase((table, calls) => {
            if (table !== 'agents') return undefined
            if (writeMethodOf(calls)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
            reads += 1
            return { data: reads === 1 ? null : { id: 'cos-raced' } }
        })
        await expect(ensureForemanAgentRow(db.client, 7)).resolves.toBe('cos-raced')
    })

    it('throws on a read that failed rather than write a second row', async () => {
        const db = fakeSupabase(table => (table === 'agents' ? { data: null, error: { message: 'timeout' } } : undefined))
        await expect(ensureForemanAgentRow(db.client, 7)).rejects.toThrow(/timeout/)
        expect(db.writes('agents')).toEqual([])
    })
})
