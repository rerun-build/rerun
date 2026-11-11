import { describe, expect, it } from 'vitest'

import type { AgentSchedule } from '@/lib/board/next-runs'

import { teamEmptyStateOf } from './team-empty-state'

const NOW = new Date('2026-10-16T10:00:00Z').getTime()

const agent = (id: string, patch: Partial<{ name: string; handle: string | null; status: 'idle' | 'working'; disabledAt: string | null }> = {}) => ({ id, name: id, handle: null, status: 'idle' as const, disabledAt: null, ...patch })
const schedule = (patch: Partial<AgentSchedule> = {}): AgentSchedule => ({ slug: 'digest', name: 'Weekly digest', cron: null, runAt: '2026-10-16T12:00:00Z', timezone: null, enabled: true, lastRunAt: null, agentId: 'a', ...patch })

const stateOf = (agents: ReturnType<typeof agent>[], schedules: AgentSchedule[] = [], firstName = 'Alex') => teamEmptyStateOf({ agents, schedules, firstName, now: NOW })

describe('teamEmptyStateOf', () => {
    it('pushes toward a first coworker when the workspace has none', () => {
        const state = stateOf([])
        expect(state.title).toBe("Hi Alex, I'm your Chief of Staff")
        expect(state.pulse).toBeNull()
        expect(state.rows.map(row => [row.title, row.action.type])).toEqual([
            ['Build my first coworker', 'prefill'],
            ['Start from a template', 'send'],
            ['How does this work?', 'send'],
        ])
    })

    it('greets without a name when the account has none', () => {
        expect(stateOf([], [], '').title).toBe("Hi, I'm your Chief of Staff")
    })

    it('leaves switched-off coworkers out of the team', () => {
        const state = stateOf([agent('off', { disabledAt: '2026-10-01T00:00:00Z' })])
        expect(state.pulse).toBeNull()
        expect(state.rows[0].title).toBe('Build my first coworker')
    })

    it('features the coworker at work and hands the task to another one', () => {
        const state = stateOf([agent('seo', { name: 'SEO Writer' }), agent('inbox', { name: 'Inbox Triage', handle: 'inbox', status: 'working' })])
        expect(state.title).toBe("Hi Alex, I'm your Chief of Staff. Here is your team.")
        expect(state.pulse).toMatchObject({
            working: 1,
            agents: [
                { id: 'seo', working: false },
                { id: 'inbox', working: true },
            ],
        })
        expect(state.rows.map(row => [row.title, row.action])).toEqual([
            ['What is Inbox Triage doing?', { type: 'send', text: 'What is @inbox doing right now?' }],
            ['Give SEO Writer a task', { type: 'prefill', text: 'Ask @SEO Writer to ' }],
            ['Build a new coworker', { type: 'prefill', text: 'Build me a coworker that ' }],
        ])
    })

    it('asks what the first coworker did when nobody is working', () => {
        const state = stateOf([agent('seo', { name: 'SEO Writer', handle: 'seo' }), agent('inbox')])
        expect(state.rows[0]).toMatchObject({ title: 'What did SEO Writer do today?', action: { type: 'send', text: 'What did @seo do today?' } })
        expect(state.rows[1].title).toBe('Give inbox a task')
    })

    it('gives the task to the only coworker there is', () => {
        const state = stateOf([agent('seo', { name: 'SEO Writer' })])
        expect(state.rows.slice(0, 2).map(row => row.title)).toEqual(['What did SEO Writer do today?', 'Give SEO Writer a task'])
    })

    it('names the soonest routine still ahead', () => {
        const schedules = [schedule({ name: 'Later', runAt: '2026-10-17T10:00:00Z' }), schedule({ name: 'Soon' }), schedule({ name: 'Off', enabled: false, runAt: '2026-10-16T10:30:00Z' }), schedule({ name: 'Past', runAt: '2026-10-16T09:00:00Z' })]
        expect(stateOf([agent('seo')], schedules).pulse?.nextRoutine).toEqual({ name: 'Soon', at: new Date('2026-10-16T12:00:00Z').getTime() })
    })

    it('has no routine to name without schedules', () => {
        expect(stateOf([agent('seo')]).pulse?.nextRoutine).toBeNull()
    })
})
