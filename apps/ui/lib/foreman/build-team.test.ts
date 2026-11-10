import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForemanState } from './phase'

const createAgent = vi.fn()
const deriveUniqueHandles = vi.fn()
const findFreeCellsInSpace = vi.fn()
const createBoxesBatch = vi.fn()
const freeAgentSlots = vi.fn()
const installFromLibrary = vi.fn()
const installFromShare = vi.fn()
const mergeForeman = vi.fn(async () => ({}))

vi.mock('@/app/api/_services/agent.service', () => ({ createAgent, deriveUniqueHandles, findFreeCellsInSpace }))
vi.mock('@/app/api/_services/box.service', () => ({ createBoxesBatch }))
vi.mock('@/app/api/_services/capacity.service', () => ({ freeAgentSlots }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('./onboarding-tools', () => ({ installFromLibrary, installFromShare }))
vi.mock('./profile', () => ({ mergeForeman }))
vi.mock('./prompt', () => ({ foremanProfileBlock: () => 'Company: Retalk' }))

const { buildTeam, onboardingInstall, onboardingSoul } = await import('./build-team')

const CTX = { workspace: { id: 7 }, userId: 'user-1' } as never

function stateWith(foreman: ForemanState['foreman'], spaces: ForemanState['spaces'] = []): ForemanState {
    return {
        phase: 'build',
        intent: null,
        answers: { company_name: 'Retalk' },
        foreman,
        onboardingCompletedAt: 'then',
        firstName: 'Ada',
        language: 'en',
        entitled: true,
        trialSpent: false,
        trialNeedsCard: true,
        priceArm: '49',
        client: 'web',
        workspaceName: 'Retalk',
        workspacePlan: 'base',
        userEmail: null,
        spaces,
        agents: [],
    }
}

const TEAM = {
    title: 'Retalk team',
    boxes: [{ name: 'Marketing' }, { name: 'Sales' }],
    items: [
        { kind: 'agent' as const, name: 'Scout', role: 'Finds keywords', box: 'Marketing' },
        { kind: 'agent' as const, name: 'Closer', role: 'Answers demo requests', box: 'Sales' },
        { kind: 'agent' as const, name: 'Ledger', role: 'Chases invoices', box: 'Finance' },
    ],
}

const run = (state: ForemanState) => buildTeam({ ctx: CTX, state, emit: () => {} })

describe('buildTeam', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        createBoxesBatch.mockImplementation(async ({ names }: { names: string[] }) => names.map((name, index) => ({ ok: true, spaceId: `box-${name}`, name, colStart: index, rowStart: 0, colEnd: index + 4, rowEnd: 4 })))
        freeAgentSlots.mockResolvedValue(2)
        deriveUniqueHandles.mockImplementation(async (_supabase: unknown, _workspaceId: number, names: string[]) => names.map(name => name.toLowerCase()))
        findFreeCellsInSpace.mockImplementation(async (_supabase: unknown, spaceId: string, count: number) => Array.from({ length: count }, (_, index) => ({ col: index, row: spaceId.length })))
        createAgent.mockImplementation(async ({ name, enabled }: { name: string; enabled: boolean }) => ({ id: `agent-${name}`, name, disabled_at: enabled ? null : 'now' }))
    })

    it('lays out every division of the plan in one batch, the ones only an item names included, in order', async () => {
        await run(stateWith({ plan: TEAM }))
        expect(createBoxesBatch).toHaveBeenCalledWith({ workspaceId: 7, userId: 'user-1', actor: { kind: 'workspace', workspaceId: 7 }, names: ['Marketing', 'Sales', 'Finance'] })
    })

    it('reuses a Box already on the board rather than laying their company down twice', async () => {
        await run(stateWith({ plan: TEAM }, [{ id: 'existing', name: 'marketing', col_start: 0, row_start: 0, col_end: 4, row_end: 4 }]))
        expect(createBoxesBatch).toHaveBeenCalledWith(expect.objectContaining({ names: ['Sales', 'Finance'] }))
        expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Scout', spaceId: 'existing', actor: { kind: 'workspace', workspaceId: 7 } }))
    })

    it('creates every agent at once, without writing anything with a model first', async () => {
        let inFlight = 0
        let peak = 0
        createAgent.mockImplementation(async ({ name, enabled }: { name: string; enabled: boolean }) => {
            inFlight += 1
            peak = Math.max(peak, inFlight)
            await new Promise(resolve => setTimeout(resolve, 5))
            inFlight -= 1
            return { id: `agent-${name}`, name, disabled_at: enabled ? null : 'now' }
        })

        await run(stateWith({ plan: TEAM }))
        expect(peak).toBe(3)
    })

    it('decides handles, cells and slots up front, the first agents of the plan taking the slots', async () => {
        await run(stateWith({ plan: TEAM }))

        expect(deriveUniqueHandles).toHaveBeenCalledWith({}, 7, ['Scout', 'Closer', 'Ledger'])
        expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Scout', handle: 'scout', enabled: true, position: { col: 0, row: 'box-Marketing'.length } }))
        expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Closer', handle: 'closer', enabled: true }))
        expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ledger', handle: 'ledger', enabled: false }))
    })

    it('creates each agent in its own Box on a first SOUL and an install left pending', async () => {
        await run(stateWith({ plan: TEAM }))

        expect(createAgent).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Closer',
                spaceId: 'box-Sales',
                description: 'Answers demo requests',
                soulMd: expect.stringContaining('Your job: Answers demo requests.'),
                installMd: onboardingInstall(TEAM.items[1]),
                config: { setup: { required: true, completedAt: null } },
            }),
        )
        expect(createAgent.mock.calls[0][0].soulMd).toContain('Closer: Answers demo requests')
        expect(createAgent.mock.calls[0][0].soulMd).toContain('soul_update')
    })

    it('gives the lead the same pending install as the others and starts nobody', async () => {
        const result = await run(stateWith({ plan: TEAM }))

        expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Scout', installMd: onboardingInstall(TEAM.items[0]), config: { setup: { required: true, completedAt: null } } }))
        expect(result.failed).toEqual([])
        expect(result.lead).toEqual({ agentId: 'agent-Scout', name: 'Scout' })
        expect(result.agents.find(agent => agent.name === 'Scout')?.lead).toBe(true)
        expect(result.agents.find(agent => agent.name === 'Ledger')).toMatchObject({ active: false })
        expect(mergeForeman).toHaveBeenCalledWith(CTX, { firstRunAt: expect.any(String) })
    })

    it('reports an agent that could not be created beside the ones that were', async () => {
        createAgent.mockImplementation(async ({ name }: { name: string }) => {
            if (name === 'Closer') throw new Error('engine unreachable')
            return { id: `agent-${name}`, name, disabled_at: null }
        })

        const result = await run(stateWith({ plan: TEAM }))
        expect(result.failed).toEqual([{ name: 'Closer', error: 'engine unreachable' }])
        expect(result.agents.map(agent => agent.name)).toEqual(['Scout', 'Ledger'])
    })

    it('lands a template in its Box and makes its first agent the lead', async () => {
        installFromLibrary.mockResolvedValue({ imported: 2, inactive: 0, agentIds: ['t-1', 't-2'], failed: [], warnings: [] })
        const plan = { title: 'Newsroom', boxes: [{ name: 'Content' }], items: [{ kind: 'template' as const, slug: 'seo-newsroom', title: 'SEO Newsroom', box: 'Content' }] }

        const result = await run(stateWith({ plan }))

        expect(createAgent).not.toHaveBeenCalled()
        expect(installFromLibrary).toHaveBeenCalledWith(CTX, { slug: 'seo-newsroom', boxId: 'box-Content' }, { purchased: true })
        expect(result.lead).toEqual({ agentId: 't-1', name: 'SEO Newsroom' })
    })

    it('refuses to build without a confirmed plan', async () => {
        await expect(run(stateWith({}))).rejects.toThrow('no confirmed plan')
        expect(createBoxesBatch).not.toHaveBeenCalled()
    })
})

describe('onboardingInstall', () => {
    const scout = TEAM.items[0]

    it('aims the first run at the pain the interview dug out', () => {
        const install = onboardingInstall({ ...scout, need: "Don't know where users hang out" })
        expect(install).toContain("They told you what goes wrong there: Don't know where users hang out. Your first result goes straight at that.")
        expect(install).toContain('4. Do the job once, on their real data, aimed at what they told you goes wrong, and show them the result.')
    })

    it('hands down what they wrote on the website, and the apps they picked there', () => {
        const install = onboardingInstall(scout, { kind: 'prompt', text: 'Find keywords every Monday', apps: ['ahrefs', 'google-sheets'] })
        expect(install).toContain('What they asked for in their own words, before signing up: "Find keywords every Monday".')
        expect(install).toContain('They already picked these apps on the website: ahrefs, google-sheets.')
    })

    it('names no app for a prompt that came without any', () => {
        expect(onboardingInstall(scout, { kind: 'prompt', text: 'Find keywords' })).not.toContain('already picked')
    })

    it('hands down what they wrote when they changed the plan, word for word', () => {
        const asked = 'Creator-style carousels.\nThe app is never the main subject.'
        const install = onboardingInstall({ ...scout, asked })
        expect(install).toContain(`What they asked for when they changed the plan, in their own words:\n<brief>\n${asked}\n</brief>`)
        expect(install).toContain('That is the brief: your first result follows it')
        expect(onboardingSoul({ ...scout, asked }, stateWith({ plan: TEAM }))).toContain(`<brief>\n${asked}\n</brief>`)
    })

    it('hands down what the plan card promised it hands over, in the install and the SOUL', () => {
        const promised = { ...scout, gets: ['A shortlist of companies with marketing needs', 'Why each one needs marketing help'], delivered: 'Qualified companies for your review' }
        expect(onboardingInstall(promised)).toContain('4. Do the job once, on their real data, and show them the result, in the shape the plan promised them (A shortlist of companies with marketing needs; Why each one needs marketing help).')
        expect(onboardingSoul(promised, stateWith({ plan: TEAM }))).toContain('What the plan they confirmed promised you hand back:\n- A shortlist of companies with marketing needs\n- Why each one needs marketing help\nEach run ends with: Qualified companies for your review')
        expect(onboardingSoul(scout, stateWith({ plan: TEAM }))).not.toContain('promised you hand back')
    })

    it('asks what makes a person or a company fit before a first list, unless the brief says it', () => {
        expect(onboardingInstall(scout)).toContain('When what you hand back is a list of people or companies, what makes one of them fit (who exactly, where, on which criteria) is part of that: ask it in one ask_user, unless the brief already says it.')
    })

    it('shows what works without an app before offering it, and keeps delivering when it is skipped', () => {
        const install = onboardingInstall(scout)
        expect(install).toContain('first show what you can already do without it')
        expect(install).toContain('A skipped app is an answer')
        expect(install).not.toContain('wait until they come back connected')
    })

    it('proposes its first skill instead of writing one, as the engine prompt requires', () => {
        const install = onboardingInstall(scout)
        expect(install).not.toContain('skill_create')
        expect(install).toContain('as a skill with skill_propose')
    })

    it('reads as before for an agent without one', () => {
        const install = onboardingInstall(scout)
        expect(install).not.toContain('changed the plan')
        expect(install).not.toContain('goes wrong')
        expect(install).not.toContain('before signing up')
        expect(install).toContain('4. Do the job once, on their real data, and show them the result.')
    })
})
