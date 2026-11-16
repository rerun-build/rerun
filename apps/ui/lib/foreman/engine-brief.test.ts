import { foremanBriefSchema } from '@rerun/contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('server-only', () => ({}))

import { foremanEngineBrief, FOREMAN_ENGINE_HUB_TOOL_NAMES } from './engine-brief'
import type { ForemanState } from './phase'

const state = {
    phase: 'companion',
    intent: null,
    answers: {},
    foreman: {},
    onboardingCompletedAt: null,
    firstName: 'Ada',
    language: 'fr',
    entitled: true,
    trialSpent: false,
    trialNeedsCard: true,
    priceArm: '49',
    client: 'web',
    workspaceName: 'Acme',
    workspacePlan: 'pro',
    userEmail: 'ada@acme.test',
    spaces: [],
    agents: [],
} as unknown as ForemanState

describe('foremanEngineBrief', () => {
    const brief = foremanEngineBrief(state)

    it('is a brief the engine accepts', () => {
        expect(() => foremanBriefSchema.parse(brief)).not.toThrow()
    })

    it('runs the workspace tools on the hub and the board gestures in the browser', () => {
        const kinds = Object.fromEntries(brief.tools.map(tool => [tool.name, tool.kind]))
        expect(kinds.create_agent).toBe('hub')
        expect(kinds.create_boxes).toBe('hub')
        expect(kinds.search_docs).toBe('hub')
        expect(kinds.focus_agent).toBe('intent')
        expect(kinds.recenter_board).toBe('intent')
    })

    // The engine can neither draw them nor read the browser's answer back. Delegation is the
    // engine's own builtin, not the hub's.
    it('leaves out the widgets, attachments, delegation and moves', () => {
        const names = brief.tools.map(tool => tool.name)
        for (const name of ['show_plan', 'ask_choice', 'open_checkout', 'show_templates', 'read_attachment', 'delegate_tasks', 'move_agent']) expect(names).not.toContain(name)
    })

    it('gives the orchestrator the library, the setup handoff, triggers, SQL and shares', () => {
        const kinds = Object.fromEntries(brief.tools.map(tool => [tool.name, tool.kind]))
        for (const name of ['list_templates', 'install_template', 'install_shared_agent', 'start_agent_setup', 'analyze_website', 'upsert_trigger', 'test_trigger', 'db_query', 'space_db_query', 'create_agent_share', 'read_skill_file', 'list_connectors']) expect(kinds[name]).toBe('hub')
        expect(kinds.open_template_card).toBe('intent')
    })

    // The brain is written by the engine's own builtins; the browser only shows the page.
    it('opens the brain in the browser', () => {
        const kinds = Object.fromEntries(brief.tools.map(tool => [tool.name, tool.kind]))
        expect(kinds.open_brain_page).toBe('intent')
        expect(brief.instructions).toContain('open_brain_page')
    })

    // They write the onboarding answers of the person going through it, not the workspace.
    it('never hands it the onboarding writes', () => {
        for (const name of ['save_profile', 'save_needs', 'finish_onboarding']) expect(FOREMAN_ENGINE_HUB_TOOL_NAMES.has(name)).toBe(false)
    })

    // The library list, not the template-authoring one the account MCP server carries under the
    // same name.
    it('lists the library templates', () => {
        const listTemplates = brief.tools.find(tool => tool.name === 'list_templates')
        expect(listTemplates?.description).toContain('Rerun library')
        expect(brief.tools.filter(tool => tool.name === 'list_templates')).toHaveLength(1)
    })

    it('reads the Vault on the hub', () => {
        expect(brief.tools.find(tool => tool.name === 'list_vault')?.kind).toBe('hub')
        expect(brief.instructions).toContain('list_vault')
    })

    // The ceiling is compiled into every engine already deployed: past it, each message to the
    // foreman is refused by the box.
    it('stays within the 64 tools a deployed engine accepts', () => {
        expect(brief.tools.length).toBeLessThanOrEqual(64)
    })

    it('never lets two creations overlap', () => {
        const serial = brief.tools.filter(tool => tool.serial).map(tool => tool.name)
        expect(serial.sort()).toEqual(['create_agent', 'create_boxes', 'install_shared_agent', 'install_template'])
    })

    // The engine drops a tool whose schema it cannot turn into zod, silently.
    it('declares only schemas the engine can convert', () => {
        for (const tool of brief.tools) expect(() => z.fromJSONSchema(tool.inputSchema as never), tool.name).not.toThrow()
    })

    it('has no two tools with the same name', () => {
        const names = brief.tools.map(tool => tool.name)
        expect(new Set(names).size).toBe(names.length)
    })

    it('hands every hub tool it declares to the hub allowlist', () => {
        for (const tool of brief.tools.filter(t => t.kind === 'hub')) expect(FOREMAN_ENGINE_HUB_TOOL_NAMES.has(tool.name)).toBe(true)
    })

    // A workspace keeps its machine, and its foreman, for a while after its plan lapses.
    it('tells it when the workspace has no plan, and only then', () => {
        expect(brief.instructions).not.toContain('no active plan')
        expect(foremanEngineBrief({ ...state, entitled: false }).instructions).toContain('no active plan')
    })

    // Every turn on the engine starts from a message the user wrote, so the browser has nothing to
    // add, and repeating it there talks the model out of the language they write in.
    it('never passes the browser language on, only the one they settled on', () => {
        const guessed = foremanEngineBrief({ ...state, language: 'German' }).instructions
        expect(guessed).not.toContain('browser is set')
        expect(guessed).not.toContain('German')
        expect(foremanEngineBrief({ ...state, foreman: { language: 'French' } }).instructions).toContain('writing in French')
    })

    it('tells it to ask with ask_user and to get an approval before deleting', () => {
        expect(brief.instructions).toContain('ask_user')
        expect(brief.instructions).toContain('request_approval')
        expect(brief.instructions).not.toContain('ask_choice')
        expect(brief.instructions).not.toContain('read_attachment')
        expect(brief.instructions).toContain('Workspace: Acme')
        expect(brief.instructions).toContain('agent_files_')
        expect(brief.instructions).toContain('search_docs')
    })
})
