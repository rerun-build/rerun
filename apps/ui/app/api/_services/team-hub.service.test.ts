import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAgentChatTarget } from '@/app/api/_services/chat.service'
import { dispatchAccountTool } from '@/app/api/_services/mcp-account.service'
import { getAgent } from '@/lib/engine/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

import { dispatchTeamHubTool, isTeamHubTool } from './team-hub.service'

vi.mock('@/app/api/_services/chat.service', () => ({ getAgentChatTarget: vi.fn() }))
vi.mock('@/app/api/_services/mcp-account.service', () => ({ dispatchAccountTool: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ getAgent: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: vi.fn() }))

const WORKSPACE_ID = 7

function callerWithTeam(team: boolean) {
    vi.mocked(getAgent).mockResolvedValue({ config: { tools: { team } } } as never)
}

describe('dispatchTeamHubTool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getAgentChatTarget).mockResolvedValue({ conn: { baseUrl: 'https://box', apiKey: 'k' }, engineAgentId: 'engine-auditor' } as never)
        vi.mocked(dispatchAccountTool).mockResolvedValue({ ok: true })
        vi.mocked(selectMaybeSingle).mockResolvedValue({ data: null } as never)
        callerWithTeam(true)
    })

    it('knows only the five read tools', () => {
        for (const name of ['team_status', 'team_list_schedules', 'team_list_triggers', 'team_list_runs', 'team_get_run']) expect(isTeamHubTool(name)).toBe(true)
        for (const name of ['upsert_schedule', 'delete_agent', 'send_message', 'run_schedule_now', 'team_delete', 'toString', 'constructor']) expect(isTeamHubTool(name)).toBe(false)
    })

    it.each([
        ['team_status', 'get_team_status'],
        ['team_list_schedules', 'list_schedules'],
        ['team_list_runs', 'list_runs'],
        ['team_get_run', 'get_run'],
    ] as const)('reads %s through the account tool %s, as the workspace', async (name, accountTool) => {
        const args = { agentId: 'a1', runId: 'r1' }
        expect(await dispatchTeamHubTool('auditor', WORKSPACE_ID, name, args)).toEqual({ ok: true })
        expect(dispatchAccountTool).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: WORKSPACE_ID }, accountTool, args)
    })

    it('checks the switch on the calling coworker', async () => {
        await dispatchTeamHubTool('auditor', WORKSPACE_ID, 'team_status', {})
        expect(getAgentChatTarget).toHaveBeenCalledWith('auditor', 'use', expect.objectContaining({ workspaceId: WORKSPACE_ID }))
        expect(getAgent).toHaveBeenCalledWith({ baseUrl: 'https://box', apiKey: 'k' }, 'engine-auditor')
    })

    it('refuses when the switch is off, before reading anything', async () => {
        callerWithTeam(false)
        await expect(dispatchTeamHubTool('auditor', WORKSPACE_ID, 'team_list_runs', { agentId: 'a1' })).rejects.toThrow('switched off')
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('keeps the webhook URLs, which carry their secret, out of the triggers', async () => {
        vi.mocked(dispatchAccountTool).mockResolvedValue({ triggers: [{ slug: 'stripe', name: 'Stripe', url: 'https://hub/t/secret', fireCount: 3 }] })
        expect(await dispatchTeamHubTool('auditor', WORKSPACE_ID, 'team_list_triggers', { agentId: 'a1' })).toEqual({ triggers: [{ slug: 'stripe', name: 'Stripe', fireCount: 3 }] })
        expect(dispatchAccountTool).toHaveBeenCalledWith(expect.anything(), 'list_triggers', { agentId: 'a1' })
    })

    it('reads the team for the Chief of Staff the way it does for a coworker', async () => {
        expect(await dispatchTeamHubTool('foreman', WORKSPACE_ID, 'team_status', {})).toEqual({ ok: true })
        expect(getAgentChatTarget).toHaveBeenCalledWith('foreman', 'use', expect.objectContaining({ workspaceId: WORKSPACE_ID }))
    })

    it('reads the team with the access of the member a Chief of Staff turn speaks for', async () => {
        const member = { kind: 'user', userId: 'user-7', workspaceId: WORKSPACE_ID, role: 'member', boxScope: 'assigned' } as const
        await dispatchTeamHubTool('foreman', WORKSPACE_ID, 'team_list_runs', { agentId: 'a1' }, member)
        expect(getAgentChatTarget).toHaveBeenCalledWith('foreman', 'use', member)
        expect(dispatchAccountTool).toHaveBeenCalledWith(member, 'list_runs', { agentId: 'a1' })
    })

    it.each(['team_status', 'team_list_schedules', 'team_list_triggers', 'team_list_runs', 'team_get_run'] as const)('finds the coworker %s names by its engine id', async name => {
        vi.mocked(selectMaybeSingle).mockResolvedValue({ data: { id: 'row-1' } } as never)
        vi.mocked(dispatchAccountTool).mockResolvedValue({ triggers: [] })
        await dispatchTeamHubTool('auditor', WORKSPACE_ID, name, { agentId: 'engine-1', runId: 'r1' })
        expect(selectMaybeSingle).toHaveBeenCalledWith(undefined, 'agents', ['id'], { engine_agent_id: 'engine-1', workspace_id: WORKSPACE_ID })
        expect(dispatchAccountTool).toHaveBeenCalledWith(expect.anything(), expect.anything(), { agentId: 'row-1', runId: 'r1' })
    })

    it('leaves the id of a coworker outside the workspace to the access check', async () => {
        vi.mocked(dispatchAccountTool).mockRejectedValue(new Error('Coworker not found'))
        await expect(dispatchTeamHubTool('auditor', WORKSPACE_ID, 'team_list_runs', { agentId: 'engine-elsewhere' })).rejects.toThrow('Coworker not found')
        expect(dispatchAccountTool).toHaveBeenCalledWith(expect.anything(), 'list_runs', { agentId: 'engine-elsewhere' })
    })
})
