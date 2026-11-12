import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type SupabaseResult } from '@/test/supabase-fake'
import { loadWhatsAppRecipient } from './recipient'
import { deliverWhatsApp } from './send'
import { firstResultPhrase, pendingActionPhrase } from './trial-phrases'
import { sweepTrialSequence } from './trial-sequence'

vi.mock('./send', () => ({ deliverWhatsApp: vi.fn() }))
vi.mock('./recipient', () => ({ loadWhatsAppRecipient: vi.fn() }))
vi.mock('./trial-phrases', () => ({
    firstResultPhrase: vi.fn(),
    overnightResultPhrase: vi.fn(),
    teaserPhrase: vi.fn(),
    pendingActionPhrase: vi.fn(),
    weeklyIdeaPhrase: vi.fn(),
}))
vi.mock('@/ee/lib/lifecycle/recipient', () => ({ loadFirstName: vi.fn(async () => 'Lucien') }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(async () => null) }))
vi.mock('@/lib/og/board-image', () => ({ boardImageUrl: vi.fn((scene: unknown) => `https://app.rerun.build/og/board?scene=${JSON.stringify(scene)}`) }))

type Tables = Partial<Record<'workspaces' | 'workspace_members' | 'agents' | 'notifications' | 'sessions' | 'user_phones' | 'whatsapp_messages' | 'workspace_getting_started', SupabaseResult>>

const HOUR = 60 * 60_000
const START = new Date('2026-10-10T14:00:00.000Z')
const TRIAL_STARTED_AT = '2026-10-10T14:00:00+00:00'
const TRIAL_ENDS_AT = '2026-10-15T14:00:00+00:00'
const DAY_ZERO_EVENING = new Date(START.getTime() + 3.5 * HOUR)

const FIRST_JOB = {
    id: 'notif-1',
    agent_id: 'agent-1',
    engine_agent_id: 'lead-scout',
    engine_session_id: 'session-1',
    event: 'agent.message.completed',
    kind: 'done',
    source: null,
    message: 'I found 12 founders hiring in Paris.',
    created_at: '2026-10-10T15:00:00.000Z',
}

function database(overrides: Tables = {}) {
    const tables: Tables = {
        workspaces: { data: [{ id: 7, trial_started_at: TRIAL_STARTED_AT, trial_ends_at: TRIAL_ENDS_AT, subscription_cancel_at: null }] },
        workspace_members: { data: [{ user_id: 'owner' }] },
        agents: { data: [{ id: 'agent-1', name: 'Lead Scout' }, { id: 'agent-2', name: 'Meeting Booker' }] },
        notifications: { data: [FIRST_JOB] },
        sessions: { data: [] },
        user_phones: { data: { whatsapp_replied_at: null } },
        whatsapp_messages: { data: [] },
        workspace_getting_started: { data: null },
        ...overrides,
    }
    return fakeSupabase(table => tables[table as keyof Tables])
}

const delivered = () => vi.mocked(deliverWhatsApp).mock.calls[0][1]

describe('sweepTrialSequence', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(deliverWhatsApp).mockResolvedValue({ sent: true, id: 'row-1' })
        vi.mocked(loadWhatsAppRecipient).mockResolvedValue({ ok: true, phone: '+32492000000' })
        vi.mocked(firstResultPhrase).mockResolvedValue('12 founders hiring in Paris')
        vi.mocked(pendingActionPhrase).mockResolvedValue('send a first message to 12 founders')
    })

    it('reads the trials still running, sandboxes left out', async () => {
        const db = database()

        await sweepTrialSequence(db.client, DAY_ZERO_EVENING)

        const filters = db.chainsOn('workspaces')[0].map(call => [call.method, ...call.args])
        expect(filters).toContainEqual(['eq', 'subscription_status', 'trialing'])
        expect(filters).toContainEqual(['eq', 'is_sandbox', false])
        expect(filters).toContainEqual(['gt', 'trial_ends_at', DAY_ZERO_EVENING.toISOString()])
        expect(filters).toContainEqual(['not', 'trial_started_at', 'is', null])
    })

    it('leaves a trial the mobile app sold through its store to the store', async () => {
        const db = database({ workspaces: { data: [{ id: 7, trial_started_at: TRIAL_STARTED_AT, trial_ends_at: TRIAL_ENDS_AT, subscription_cancel_at: null, billing_provider: 'apple' }] } })
        expect(await sweepTrialSequence(db.client, DAY_ZERO_EVENING)).toEqual({ considered: 0, sent: [], skipped: [] })
        expect(deliverWhatsApp).not.toHaveBeenCalled()
    })

    it('celebrates the first job on day 0, pointing at the schedules of the coworker who did it', async () => {
        const report = await sweepTrialSequence(database().client, DAY_ZERO_EVENING)

        expect(report).toEqual({ considered: 1, sent: [{ workspaceId: 7, key: 'trial_first_job_done' }], skipped: [] })
        expect(firstResultPhrase).toHaveBeenCalledWith('I found 12 founders hiring in Paris.')
        expect(delivered()).toMatchObject({ userId: 'owner', workspaceId: 7, language: 'en', dedupeKey: 'trial:7:day0' })
        expect(delivered().message).toMatchObject({
            slug: 'rerun_trial_first_job_done',
            components: [
                { type: 'header', parameters: [{ type: 'image', url: expect.stringContaining('"name":"Lead Scout","status":"working"') }] },
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', name: 'first_name', text: 'Lucien' },
                        { type: 'text', name: 'result', text: '12 founders hiring in Paris' },
                    ],
                },
                { type: 'button', parameters: [{ type: 'text', text: '?agent=agent-1&tab=scheduled&ref=whatsapp&wa=trial_first_job_done' }] },
            ],
        })
    })

    it('sends nothing when the model finds nothing true to say', async () => {
        vi.mocked(firstResultPhrase).mockResolvedValueOnce(null)

        const report = await sweepTrialSequence(database().client, DAY_ZERO_EVENING)

        expect(deliverWhatsApp).not.toHaveBeenCalled()
        expect(report.skipped).toEqual(['7: trial_first_job_done: no_phrase'])
    })

    it('asks for the OK a coworker is waiting on, in place of the day’s message', async () => {
        const question = { ...FIRST_JOB, id: 'notif-2', event: 'agent.notification', kind: 'approval', engine_session_id: 'session-2', message: 'Can I send these 12 messages?' }

        await sweepTrialSequence(database({ notifications: { data: [question, FIRST_JOB] }, sessions: { data: [{ engine_session_id: 'session-2' }] } }).client, DAY_ZERO_EVENING)

        expect(pendingActionPhrase).toHaveBeenCalledWith('Can I send these 12 messages?')
        expect(delivered().message.slug).toBe('rerun_trial_needs_your_ok')
        expect(delivered().message.components.at(-1)).toEqual({ type: 'button', parameters: [{ type: 'text', text: '?notification=notif-2&ref=whatsapp&wa=trial_needs_your_ok' }] })
    })

    it('asks nothing of a model or an engine for someone WhatsApp cannot reach', async () => {
        vi.mocked(loadWhatsAppRecipient).mockResolvedValueOnce({ ok: false, reason: 'no_phone' })

        const report = await sweepTrialSequence(database().client, DAY_ZERO_EVENING)

        expect(vi.mocked(loadWhatsAppRecipient).mock.calls[0][2]).toBe('marketing')
        expect(firstResultPhrase).not.toHaveBeenCalled()
        expect(report.skipped).toEqual(['7: no_phone'])
    })

    it('stays quiet between two slots and after a reply', async () => {
        expect(await sweepTrialSequence(database().client, new Date(START.getTime() + 12 * HOUR))).toEqual({ considered: 1, sent: [], skipped: [] })

        const report = await sweepTrialSequence(database({ user_phones: { data: { whatsapp_replied_at: '2026-10-10T16:00:00.000Z' } } }).client, DAY_ZERO_EVENING)
        expect(report.skipped).toEqual(['7: replied'])
        expect(deliverWhatsApp).not.toHaveBeenCalled()
    })

    it('carries on past a workspace that throws', async () => {
        vi.mocked(deliverWhatsApp).mockRejectedValueOnce(new Error('bird down'))
        const trial = { trial_started_at: TRIAL_STARTED_AT, trial_ends_at: TRIAL_ENDS_AT, subscription_cancel_at: null }
        const workspaces = { data: [{ id: 7, ...trial }, { id: 8, ...trial }] }

        const report = await sweepTrialSequence(database({ workspaces }).client, DAY_ZERO_EVENING)

        expect(report).toEqual({ considered: 2, sent: [{ workspaceId: 8, key: 'trial_first_job_done' }], skipped: ['7: bird down'] })
    })
})
