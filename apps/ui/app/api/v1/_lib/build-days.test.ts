import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, tableResolver, type FakeSupabase } from '@/test/supabase-fake'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, failNext: false }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))

const { recordBuildDay } = await import('./build-days')

const call = (client?: string) => new Request('https://app.rerun.build/api/v1/me', { headers: client ? { 'x-rerun-client': client } : {} })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const MORNING = new Date('2026-11-19T07:00:00.000Z')

describe('recordBuildDay', () => {
    beforeEach(() => {
        state.db = fakeSupabase((table, calls) => (state.failNext ? ((state.failNext = false), { error: { message: 'connection terminated' } }) : tableResolver({})(table, calls)))
    })

    it('counts the build a person runs, once that day', async () => {
        recordBuildDay(call('ios/1.0.2 (38)'), 'user-ada', MORNING)
        recordBuildDay(call('ios/1.0.2 (38)'), 'user-ada', new Date('2026-11-19T21:00:00.000Z'))
        await flush()
        expect(state.db?.writes('app_build_days')).toEqual([{ method: 'upsert', payload: { day: '2026-11-19', platform: 'ios', build: 38, version: '1.0.2', user_id: 'user-ada' }, filters: [] }])
    })

    it('counts again on another day, another build, another person', async () => {
        recordBuildDay(call('android/1.0.2 (7)'), 'user-grace', MORNING)
        recordBuildDay(call('android/1.0.2 (7)'), 'user-grace', new Date('2026-11-20T07:00:00.000Z'))
        recordBuildDay(call('android/1.0.3 (8)'), 'user-grace', new Date('2026-11-20T08:00:00.000Z'))
        recordBuildDay(call('android/1.0.3 (8)'), 'user-linus', new Date('2026-11-20T08:00:00.000Z'))
        await flush()
        expect(state.db?.writes('app_build_days').map(write => write.payload)).toHaveLength(4)
    })

    it('counts nothing for a call without the header, the web or an iOS build from before it', async () => {
        recordBuildDay(call(), 'user-ada', MORNING)
        recordBuildDay(call('Mozilla/5.0'), 'user-ada', MORNING)
        await flush()
        expect(state.db?.writes('app_build_days')).toEqual([])
    })

    it('tries again on the next call when a write failed, without getting in its way', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        state.failNext = true
        recordBuildDay(call('ios/1.0.2 (38)'), 'user-margaret', MORNING)
        await flush()
        expect(warn).toHaveBeenCalledWith('[api/v1] could not count the build of the app', 'connection terminated')
        recordBuildDay(call('ios/1.0.2 (38)'), 'user-margaret', MORNING)
        await flush()
        expect(state.db?.writes('app_build_days')).toHaveLength(2)
    })

    it('never throws into the call, even without a database', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        state.db = null
        expect(() => recordBuildDay(call('ios/1.0.2 (38)'), 'user-alan', MORNING)).not.toThrow()
    })
})
