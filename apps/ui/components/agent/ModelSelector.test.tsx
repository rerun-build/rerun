// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The picker writes the conversation's override, which the chat transport sends with every message.
// One it writes on its own pins the conversation for good: a workspace running on Claude ended up
// spending its Rerun credit, and being told it was used up, after a single failed read of the agent.

const mocks = vi.hoisted(() => ({ getAgentContextAction: vi.fn(), listAiConnectionsAction: vi.fn(), updateAgentConfigAction: vi.fn(), canManage: true, boardAgentIds: [] as string[] }))

vi.mock('@/app/api/_actions/agent.actions', () => ({ getAgentContextAction: mocks.getAgentContextAction, updateAgentConfigAction: mocks.updateAgentConfigAction }))
vi.mock('@/app/api/_actions/workspace-connection.actions', () => ({
    listAiConnectionsAction: mocks.listAiConnectionsAction,
    refreshAiConnectionsAction: vi.fn(),
    createAiConnectionAction: vi.fn(),
    deleteAiConnectionAction: vi.fn(),
    setDefaultModelAction: vi.fn(),
    updateAiConnectionAction: vi.fn(),
    updateAiConnectionKeysAction: vi.fn(),
}))
vi.mock('@/supabase/session/SessionProvider', () => ({
    useSession: () => ({ workspace: { id: 1, subscription_status: 'trialing', is_sandbox: false, rerun_budget_micros: 0, rerun_used_micros: 0, rerun_topup_micros: 0 } }),
    useOptionalSession: () => null,
}))
vi.mock('@rerun/analytics/client', () => ({ track: vi.fn() }))
vi.mock('@/hooks/useBoxAccess', () => ({ useCanManageAgent: () => mocks.canManage }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: { agents: { id: string }[] }) => unknown) => select({ agents: mocks.boardAgentIds.map(id => ({ id })) }) }))

const connection = (id: string, provider: string, models: string[]) => ({
    id,
    name: id === 'rerun' ? 'Rerun' : 'Claude',
    provider,
    models,
    extraModels: [],
    createdAt: '2026-11-04T10:00:00.000Z',
    connected: true,
    credentialRejected: false,
    planLimits: null,
    cliModels: null,
    providerModels: null,
})

const CLAUDE_DEFAULT = {
    connections: [connection('rerun', 'rerun', ['rerun-max', 'rerun-fast', 'rerun-smart']), connection('claude-1', 'claude', ['claude-sonnet-5-5', 'claude-opus-5-5'])],
    default: { connectionId: 'claude-1', model: 'claude-sonnet-5-5' },
    opencodeOffered: false,
    customOffered: false,
}

const modelContext = (model: Record<string, unknown>) => ({ model: { connectionId: null, model: null, effort: null, resolvedConnectionId: null, resolvedModel: null, loaded: true, ...model }, setup: null })
const FAILED_READ = modelContext({ loaded: false })
const FOLLOWS_CLAUDE = modelContext({ resolvedConnectionId: 'claude-1', resolvedModel: 'claude-sonnet-5-5' })

let root: Root | null = null
let container: HTMLElement | null = null

async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

async function mount(agentId: string, onReadyChange?: (ready: boolean) => void, props: { pickerKey?: string; onPicked?: () => void; conversationId?: string } = {}) {
    const { ModelSelector } = await import('@/components/agent/ModelSelector')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(createElement(ModelSelector, { agentId, onReadyChange, ...props }))
    })
    await settle()
}

async function openPicker() {
    const trigger = container!.querySelector('button')!
    await act(async () => {
        trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        trigger.click()
    })
    await settle()
}

async function pickModel(label: string) {
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes(label))
    expect(option).toBeDefined()
    await act(async () => option!.click())
    await settle()
}

const storedOverride = (agentId: string) => {
    const raw = localStorage.getItem(`rerun-agent-model-${agentId}`)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
}

// Each test imports ModelSelector afresh after vi.resetModules(), its whole module graph with it: on a
// loaded machine that alone can pass vitest's default 5 s.
const REIMPORT_TIMEOUT = { timeout: 20_000 }

describe('ModelSelector override', REIMPORT_TIMEOUT, () => {
    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        mocks.getAgentContextAction.mockReset()
        mocks.listAiConnectionsAction.mockResolvedValue(CLAUDE_DEFAULT)
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    it('writes nothing for an agent that follows a usable Box default', async () => {
        mocks.getAgentContextAction.mockResolvedValue(FOLLOWS_CLAUDE)
        const onReadyChange = vi.fn()
        await mount('follows', onReadyChange)
        expect(storedOverride('follows')).toBeNull()
        expect(onReadyChange).toHaveBeenLastCalledWith(true)
    })

    it('writes nothing after a failed read of the agent', async () => {
        mocks.getAgentContextAction.mockResolvedValueOnce(FAILED_READ).mockResolvedValue(FOLLOWS_CLAUDE)
        await mount('flaky')
        expect(storedOverride('flaky')).toBeNull()
    })

    it('leaves an agent following the Box alone when the picker cannot show what the engine resolved', async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ resolvedConnectionId: 'rerun', resolvedModel: 'rerun-fast' }))
        const onReadyChange = vi.fn()
        await mount('hidden-default', onReadyChange)
        expect(storedOverride('hidden-default')).toBeNull()
        expect(onReadyChange).toHaveBeenLastCalledWith(true)
    })

    it('repoints a pin that no longer resolves at the Box default, not at Rerun', async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ connectionId: 'gone', model: 'gpt-6-astra', resolvedConnectionId: 'gone', resolvedModel: 'gpt-6-astra' }))
        await mount('stale-pin')
        expect(storedOverride('stale-pin')).toEqual({ connectionId: 'claude-1', model: 'claude-sonnet-5-5', effort: null })
    })
})

describe('ModelSelector coworker default', REIMPORT_TIMEOUT, () => {
    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        mocks.getAgentContextAction.mockResolvedValue(FOLLOWS_CLAUDE)
        mocks.listAiConnectionsAction.mockResolvedValue(CLAUDE_DEFAULT)
        mocks.updateAgentConfigAction.mockReset()
        mocks.updateAgentConfigAction.mockResolvedValue({ success: true })
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
        mocks.canManage = true
        mocks.boardAgentIds = []
    })

    it('keeps the star out of reach of someone who only uses the coworker', async () => {
        mocks.canManage = false
        mocks.boardAgentIds = ['used']
        await mount('used')
        await openPicker()
        const star = document.querySelector<HTMLButtonElement>('button[aria-label="Make Sonnet 5.5 this coworker\'s default"]')
        expect(star).not.toBeNull()
        expect(star!.disabled).toBe(true)
    })

    it('leaves the star open to a manager', async () => {
        mocks.boardAgentIds = ['managed']
        await mount('managed')
        await openPicker()
        const star = document.querySelector<HTMLButtonElement>('button[aria-label="Make Sonnet 5.5 this coworker\'s default"]')
        expect(star?.disabled).toBe(false)
    })
})

// A model picked in a chat is that chat's: the next new chat of the coworker opens on its default,
// and the star moves the chat it was clicked in onto the new default (RER-284).
describe('ModelSelector per conversation', REIMPORT_TIMEOUT, () => {
    const PINNED_SONNET = modelContext({ connectionId: 'claude-1', model: 'claude-sonnet-5-5', resolvedConnectionId: 'claude-1', resolvedModel: 'claude-sonnet-5-5' })
    const pill = () => container!.querySelector('button')!.textContent

    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        mocks.getAgentContextAction.mockResolvedValue(PINNED_SONNET)
        mocks.listAiConnectionsAction.mockResolvedValue(CLAUDE_DEFAULT)
        mocks.updateAgentConfigAction.mockReset()
        mocks.updateAgentConfigAction.mockResolvedValue({ success: true })
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    function closeChat() {
        act(() => root?.unmount())
        root = null
        container?.remove()
    }

    it('opens a new chat on the coworker default, not on the model picked in another chat', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        await mount('coworker', undefined, { conversationId: 'session-a' })
        await openPicker()
        await pickModel('Opus 5.5')
        expect(pill()).toContain('Opus 5.5')
        closeChat()

        await mount('coworker', undefined, { conversationId: 'session-b' })
        expect(pill()).toContain('Sonnet 5.5')
        expect(readAgentModel('coworker', 'session-b')).toEqual({})
        closeChat()

        await mount('coworker', undefined, { conversationId: 'session-a' })
        expect(pill()).toContain('Opus 5.5')
        expect(readAgentModel('coworker', 'session-a').model).toBe('claude-opus-5-5')
    })

    it('moves the chat the star was clicked in onto the new default', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        await mount('coworker', undefined, { conversationId: 'session-a' })
        await openPicker()
        await pickModel('Opus 5.5')
        await openPicker()
        const star = document.querySelector<HTMLButtonElement>('button[aria-label="Make Opus 5.5 this coworker\'s default"]')
        await act(async () => star!.click())
        await settle()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('coworker', { connectionId: 'claude-1', model: 'claude-opus-5-5', provider: 'claude' })
        expect(readAgentModel('coworker', 'session-a')).toEqual({})
        expect(pill()).toContain('Opus 5.5')
    })

    it('runs the chat on the starred model when another one was picked in it', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        mocks.getAgentContextAction.mockResolvedValue(FOLLOWS_CLAUDE)
        await mount('coworker', undefined, { conversationId: 'session-a' })
        await openPicker()
        await pickModel('Opus 5.5')
        await openPicker()
        const star = document.querySelector<HTMLButtonElement>('button[aria-label="Make Sonnet 5.5 this coworker\'s default"]')
        await act(async () => star!.click())
        await settle()
        expect(readAgentModel('coworker', 'session-a')).toEqual({})
        expect(pill()).toContain('Sonnet 5.5')
    })

    const starOf = (model: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Make ${model} this coworker's default"]`)!

    it('keeps the chat on the starred model while the default is being saved, and when the save is refused', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        let answer!: (result: { success: boolean }) => void
        mocks.updateAgentConfigAction.mockReturnValue(new Promise(resolve => (answer = resolve)))
        await mount('coworker', undefined, { conversationId: 'session-a' })
        await openPicker()
        await act(async () => starOf('Opus 5.5').click())
        await settle()
        expect(pill()).toContain('Opus 5.5')
        expect(readAgentModel('coworker', 'session-a').model).toBe('claude-opus-5-5')

        await act(async () => answer({ success: false }))
        await settle()
        expect(readAgentModel('coworker', 'session-a').model).toBe('claude-opus-5-5')
    })

    it('keeps the chat on the starred model when the save never reaches the server', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        mocks.updateAgentConfigAction.mockRejectedValue(new Error('network'))
        await mount('coworker', undefined, { conversationId: 'session-a' })
        await openPicker()
        await act(async () => starOf('Opus 5.5').click())
        await settle()
        expect(readAgentModel('coworker', 'session-a').model).toBe('claude-opus-5-5')
    })

    it('keeps a model picked while the default is being saved', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        let answer!: (result: { success: boolean }) => void
        mocks.updateAgentConfigAction.mockReturnValue(new Promise(resolve => (answer = resolve)))
        await mount('coworker', undefined, { conversationId: 'session-a' })
        await openPicker()
        await act(async () => starOf('Opus 5.5').click())
        // "Workspace default" names the same model above it.
        const sonnet = [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(item => item.textContent?.includes('Sonnet 5.5')).at(-1)!
        await act(async () => sonnet.click())
        await settle()
        await act(async () => answer({ success: true }))
        await settle()
        expect(readAgentModel('coworker', 'session-a').model).toBe('claude-sonnet-5-5')
    })
})

// The session of a new chat comes with the answer to its first message, or for General through the
// hub's realtime channel first. The pick made before it has to be there on the first render that reads
// the session: the picker repairs a pin that no longer resolves, and would write over it.
describe('ModelSelector when a new chat opens its session', REIMPORT_TIMEOUT, () => {
    const DEAD_PIN = modelContext({ connectionId: 'gone', model: 'gpt-6-astra', resolvedConnectionId: 'gone', resolvedModel: 'gpt-6-astra' })
    const pill = () => container!.querySelector('button')!.textContent

    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        mocks.getAgentContextAction.mockReset()
        mocks.getAgentContextAction.mockResolvedValue(DEAD_PIN)
        mocks.listAiConnectionsAction.mockResolvedValue(CLAUDE_DEFAULT)
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    async function mountTabs() {
        const { ModelSelector } = await import('@/components/agent/ModelSelector')
        const { draftConversationId } = await import('@/hooks/useAgentModel')
        const { useSessionTabs } = await import('@/hooks/useSessionTabs')
        let tabs!: ReturnType<typeof useSessionTabs>
        function Panel() {
            tabs = useSessionTabs('coworker')
            const tab = tabs.tabs[tabs.activeIndex]
            return createElement(ModelSelector, { key: tab.uid, agentId: 'coworker', conversationId: tab.id ?? draftConversationId(tab.uid) })
        }
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => root!.render(createElement(Panel)))
        await settle()
        return () => tabs
    }

    it('keeps the pick of a thread', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        const tabs = await mountTabs()
        await act(async () => tabs().createNew())
        await settle()
        await openPicker()
        await pickModel('Opus 5.5')
        await act(async () => tabs().updateTabByUid(tabs().tabs[1].uid, 'session-a'))
        await settle()
        expect(readAgentModel('coworker', 'session-a').model).toBe('claude-opus-5-5')
        expect(pill()).toContain('Opus 5.5')
    })

    it('keeps the pick of General', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        const tabs = await mountTabs()
        await openPicker()
        await pickModel('Opus 5.5')
        await act(async () => tabs().setGeneralSessionId('general-row'))
        await act(async () => tabs().updateTabByUid(tabs().tabs[0].uid, 'general-row'))
        await settle()
        expect(readAgentModel('coworker', 'general-row').model).toBe('claude-opus-5-5')
        expect(pill()).toContain('Opus 5.5')
    })

    it('keeps the pick General had before a reload over the one the picker repaired meanwhile', async () => {
        localStorage.setItem('rerun-agent-model-coworker:general-row', JSON.stringify({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: null }))
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        const tabs = await mountTabs()
        await act(async () => tabs().setGeneralSessionId('general-row'))
        await settle()
        expect(readAgentModel('coworker', 'general-row').model).toBe('claude-opus-5-5')
        expect(pill()).toContain('Opus 5.5')
    })

    it('opens a new chat on the default again when the last one picked a model and was never sent', async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ connectionId: 'claude-1', model: 'claude-sonnet-5-5', resolvedConnectionId: 'claude-1', resolvedModel: 'claude-sonnet-5-5' }))
        const tabs = await mountTabs()
        await act(async () => tabs().createNew())
        await settle()
        await openPicker()
        await pickModel('Opus 5.5')
        await act(async () => tabs().createNew())
        await settle()
        expect(pill()).toContain('Opus 5.5')

        await act(async () => tabs().selectTab(0))
        await act(async () => tabs().selectTab(1))
        await settle()
        expect(pill()).toContain('Opus 5.5')

        await act(async () => tabs().selectTab(0))
        await act(async () => tabs().createNew())
        await settle()
        expect(tabs().tabs).toHaveLength(2)
        expect(pill()).toContain('Sonnet 5.5')
    })
})

// The usage limit notice opens the picker so the stopped turn goes on with the model picked there.
// Any other way of changing the model must not send a turn the user never asked for.
describe('ModelSelector opened by a notice', REIMPORT_TIMEOUT, () => {
    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        mocks.getAgentContextAction.mockResolvedValue(FOLLOWS_CLAUDE)
        mocks.listAiConnectionsAction.mockResolvedValue(CLAUDE_DEFAULT)
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    async function requestPicker(pickerKey: string) {
        const { useModelPickerStore } = await import('@/stores/model-picker.store')
        await act(async () => useModelPickerStore.getState().request(pickerKey))
        await settle()
    }

    it('says a model was picked in a picker the notice opened', async () => {
        const onPicked = vi.fn()
        await mount('noticed', undefined, { pickerKey: 'tab-1', onPicked })
        await requestPicker('tab-1')
        await pickModel('Opus 5.5')
        expect(onPicked).toHaveBeenCalledTimes(1)
        expect(storedOverride('noticed')).toEqual({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: null })
    })

    it('waits for the coworker to follow the Box before saying the Box default was picked', async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ connectionId: 'claude-1', model: 'claude-opus-5-5', resolvedConnectionId: 'claude-1', resolvedModel: 'claude-opus-5-5' }))
        let saveConfig!: () => void
        mocks.updateAgentConfigAction.mockReturnValue(new Promise<void>(resolve => (saveConfig = resolve)))
        const onPicked = vi.fn()
        await mount('pinned', undefined, { pickerKey: 'tab-1', onPicked })
        await requestPicker('tab-1')
        await pickModel('Workspace default')
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('pinned', { connectionId: null, provider: null, model: null })
        expect(onPicked).not.toHaveBeenCalled()
        await act(async () => saveConfig())
        await settle()
        expect(onPicked).toHaveBeenCalledTimes(1)
    })

    it('stays quiet for a model picked in a picker opened by hand', async () => {
        const onPicked = vi.fn()
        await mount('by-hand', undefined, { pickerKey: 'tab-1', onPicked })
        await openPicker()
        await pickModel('Opus 5.5')
        expect(onPicked).not.toHaveBeenCalled()
    })

    it('stays quiet when the notice picker closes without a pick and a model is picked later', async () => {
        const onPicked = vi.fn()
        await mount('dismissed', undefined, { pickerKey: 'tab-1', onPicked })
        await requestPicker('tab-1')
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
        await settle()
        expect(document.querySelector('[role="option"]')).toBeNull()
        await openPicker()
        await pickModel('Opus 5.5')
        expect(onPicked).not.toHaveBeenCalled()
    })

    it('stays quiet when it repoints a pin that no longer resolves', async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ connectionId: 'gone', model: 'gpt-6-astra', resolvedConnectionId: 'gone', resolvedModel: 'gpt-6-astra' }))
        const onPicked = vi.fn()
        await mount('repointed', undefined, { pickerKey: 'tab-1', onPicked })
        expect(storedOverride('repointed')).toEqual({ connectionId: 'claude-1', model: 'claude-sonnet-5-5', effort: null })
        expect(onPicked).not.toHaveBeenCalled()
    })
})

// The settings icon of a model row opens the Reasoning submenu; a level picked there picks the row
// with it. A model that takes no effort (the Rerun tiers) has no icon at all.
describe('ModelSelector reasoning effort', REIMPORT_TIMEOUT, () => {
    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        mocks.getAgentContextAction.mockResolvedValue(FOLLOWS_CLAUDE)
        mocks.listAiConnectionsAction.mockResolvedValue(CLAUDE_DEFAULT)
        mocks.updateAgentConfigAction.mockReset()
        mocks.updateAgentConfigAction.mockResolvedValue({ success: true })
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    const pill = () => container!.querySelector('button')!.textContent

    async function pickEffort(model: string, level: string) {
        const gear = document.querySelector<HTMLButtonElement>(`button[aria-label="Reasoning of ${model}"]`)
        expect(gear).not.toBeNull()
        await act(async () => gear!.click())
        await settle()
        const option = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => !container!.contains(button) && button.textContent?.startsWith(level) && button.querySelector('svg'))
        expect(option).toBeDefined()
        await act(async () => option!.click())
        await settle()
    }

    it('offers a level on the Claude models and none on the Rerun tiers', async () => {
        await mount('icons')
        await openPicker()
        const gears = [...document.querySelectorAll('button[aria-label^="Reasoning of"]')].map(button => button.getAttribute('aria-label'))
        expect(gears).toEqual(['Reasoning of Sonnet 5.5', 'Reasoning of Opus 5.5'])
    })

    it('picks the model with the level, and the pill says it', async () => {
        await mount('high')
        await openPicker()
        await pickEffort('Opus 5.5', 'High')
        expect(storedOverride('high')).toEqual({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: 'high' })
        expect(pill()).toContain('Opus 5.5 · High')
    })

    // The level sits by the model's name: in the settings button it widened it and pushed the star out
    // of the column the other rows keep it in.
    it('writes the picked level by the name, not in the settings button', async () => {
        await mount('level-label')
        await openPicker()
        await pickEffort('Opus 5.5', 'High')
        await openPicker()
        const gear = document.querySelector<HTMLButtonElement>('button[aria-label="Reasoning of Opus 5.5"]')!
        expect(gear.textContent).toBe('')
        expect(gear.closest('[data-slot="command-item"]')!.textContent).toContain('High')
    })

    it('keeps the bare model name on Default', async () => {
        await mount('default-level')
        await openPicker()
        await pickEffort('Opus 5.5', 'Default')
        expect(storedOverride('default-level')).toEqual({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: null })
        expect(pill()).not.toContain('·')
    })

    it('makes the level part of the coworker default with the star', async () => {
        await mount('starred')
        await openPicker()
        await pickEffort('Opus 5.5', 'Medium')
        await openPicker()
        const star = document.querySelector<HTMLButtonElement>('button[aria-label="Make Opus 5.5 this coworker\'s default"]')
        await act(async () => star!.click())
        await settle()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('starred', { connectionId: 'claude-1', model: 'claude-opus-5-5', provider: 'claude', effort: 'medium' })
    })

    it("offers the star again on the coworker's model picked at another level", async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: 'low', resolvedConnectionId: 'claude-1', resolvedModel: 'claude-opus-5-5' }))
        await mount('relevel')
        await openPicker()
        expect(document.querySelector('button[aria-label="Make Opus 5.5 this coworker\'s default"]')).toBeNull()
        await pickEffort('Opus 5.5', 'High')
        await openPicker()
        const star = document.querySelector<HTMLButtonElement>('button[aria-label="Make Opus 5.5 this coworker\'s default"]')
        expect(star).not.toBeNull()
        await act(async () => star!.click())
        await settle()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('relevel', { connectionId: 'claude-1', model: 'claude-opus-5-5', provider: 'claude', effort: 'high' })
    })

    // An engine older than the setting answers 403 to the field on the Chief of Staff.
    it('sends no effort with a star on the Default level when none was saved', async () => {
        await mount('bare-star')
        await openPicker()
        const star = document.querySelector<HTMLButtonElement>('button[aria-label="Make Opus 5.5 this coworker\'s default"]')
        await act(async () => star!.click())
        await settle()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('bare-star', { connectionId: 'claude-1', model: 'claude-opus-5-5', provider: 'claude' })
    })

    it('clears a saved level when the star goes back to Default', async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: 'low', resolvedConnectionId: 'claude-1', resolvedModel: 'claude-opus-5-5' }))
        await mount('unlevel')
        await openPicker()
        await pickEffort('Opus 5.5', 'Default')
        await openPicker()
        const star = document.querySelector<HTMLButtonElement>('button[aria-label="Make Opus 5.5 this coworker\'s default"]')
        await act(async () => star!.click())
        await settle()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('unlevel', { connectionId: 'claude-1', model: 'claude-opus-5-5', provider: 'claude', effort: null })
    })

    it("shows the coworker's own level when the conversation picked nothing", async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: 'low', resolvedConnectionId: 'claude-1', resolvedModel: 'claude-opus-5-5' }))
        await mount('pinned-level')
        expect(pill()).toContain('Opus 5.5 · Low')
        expect(storedOverride('pinned-level')).toBeNull()
    })
})
