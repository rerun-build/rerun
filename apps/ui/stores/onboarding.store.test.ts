import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'rerun:pending-first-agent'

function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        read: (key: string) => values.get(key),
    }
}

async function loadStore(persisted?: Record<string, unknown>) {
    const storage = memoryStorage(persisted ? { [STORAGE_KEY]: JSON.stringify({ state: persisted, version: 0 }) } : {})
    vi.stubGlobal('window', { localStorage: storage })
    vi.resetModules()
    const store = await import('./onboarding.store')
    return { ...store, storage }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

const NOW = Date.parse('2026-10-16T12:00:00Z')
const HOUR = 60 * 60 * 1000
const FRESH = { pendingFirstAgent: NOW, pendingTemplate: NOW, pendingTemplateLink: NOW, pendingShareLink: NOW }

const DRAFT = { name: 'Scout', serviceSlugs: ['hubspot'], kickoff: 'Find leads', offset: { col: 1, row: 2 } }
const TEMPLATE = { slug: 'crm-kit', title: 'CRM kit', agentCount: 3 }

describe('onboarding store rehydration', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
    })

    it('restores every valid parked entry', async () => {
        const { useOnboardingStore } = await loadStore({ pendingFirstAgent: DRAFT, pendingTemplateLink: 'kit', pendingShareLink: 'tok', firstAgentFromPrompt: true, parkedAt: FRESH })
        expect(useOnboardingStore.getState()).toMatchObject({ pendingFirstAgent: DRAFT, pendingTemplateLink: 'kit', pendingShareLink: 'tok', firstAgentFromPrompt: true })
    })

    it('drops a corrupted entry without taking the others down', async () => {
        const { useOnboardingStore } = await loadStore({
            pendingFirstAgent: { name: '', serviceSlugs: [] },
            pendingTemplate: TEMPLATE,
            pendingTemplateLink: 42,
            parkedAt: FRESH,
        })
        expect(useOnboardingStore.getState()).toMatchObject({ pendingFirstAgent: null, pendingTemplate: TEMPLATE, pendingTemplateLink: null })
    })

    it('rejects an offset that is not a whole cell', async () => {
        const { useOnboardingStore } = await loadStore({ pendingFirstAgent: { ...DRAFT, offset: { col: 1.5, row: 0 } }, parkedAt: FRESH })
        expect(useOnboardingStore.getState().pendingFirstAgent).toBeNull()
    })

    it('drops the prompt marker when the draft it qualifies did not survive', async () => {
        const { useOnboardingStore } = await loadStore({ pendingFirstAgent: { name: 'x' }, firstAgentFromPrompt: true, parkedAt: FRESH })
        expect(useOnboardingStore.getState().firstAgentFromPrompt).toBe(false)
    })

    it('drops an entry parked without a date', async () => {
        const { useOnboardingStore, hasPendingStart } = await loadStore({ pendingFirstAgent: DRAFT })
        expect(hasPendingStart(useOnboardingStore.getState())).toBe(false)
    })

    it('drops an entry parked more than a day ago and keeps a fresh one beside it', async () => {
        const { useOnboardingStore } = await loadStore({
            pendingFirstAgent: DRAFT,
            pendingShareLink: 'tok',
            firstAgentFromPrompt: true,
            parkedAt: { pendingFirstAgent: NOW - 24 * HOUR, pendingShareLink: NOW - 23 * HOUR },
        })
        expect(useOnboardingStore.getState()).toMatchObject({ pendingFirstAgent: null, firstAgentFromPrompt: false, pendingShareLink: 'tok', parkedAt: { pendingShareLink: NOW - 23 * HOUR } })
        expect(useOnboardingStore.getState().parkedAt).not.toHaveProperty('pendingFirstAgent')
    })

    it('starts empty with nothing stored', async () => {
        const { useOnboardingStore, hasPendingStart } = await loadStore()
        expect(hasPendingStart(useOnboardingStore.getState())).toBe(false)
    })
})

describe('onboarding store actions', () => {
    it('dates every entry it parks', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
        const { useOnboardingStore } = await loadStore()
        const store = useOnboardingStore.getState()
        store.setPendingFirstAgent(DRAFT)
        store.setPendingTemplate(TEMPLATE)
        store.setPendingTemplateLink('kit')
        store.setPendingShareLink('tok')
        expect(useOnboardingStore.getState().parkedAt).toEqual(FRESH)
    })

    it('keeps a single thing waiting to land', async () => {
        const { useOnboardingStore } = await loadStore()
        const store = useOnboardingStore.getState()
        store.setPendingTemplate(TEMPLATE)
        store.setPendingFirstAgent(DRAFT)
        expect(useOnboardingStore.getState()).toMatchObject({ pendingFirstAgent: DRAFT, pendingTemplate: null })
        store.markFirstAgentFromPrompt()
        store.setPendingTemplate(TEMPLATE)
        expect(useOnboardingStore.getState()).toMatchObject({ pendingFirstAgent: null, pendingTemplate: TEMPLATE, firstAgentFromPrompt: false })
    })

    it('clears the prompt marker with the draft', async () => {
        const { useOnboardingStore } = await loadStore({ pendingFirstAgent: DRAFT, firstAgentFromPrompt: true })
        useOnboardingStore.getState().clearPendingFirstAgent()
        expect(useOnboardingStore.getState()).toMatchObject({ pendingFirstAgent: null, firstAgentFromPrompt: false })
    })

    it('counts a parked share link as a pending start', async () => {
        const { useOnboardingStore, hasPendingStart } = await loadStore()
        useOnboardingStore.getState().setPendingShareLink('tok')
        expect(hasPendingStart(useOnboardingStore.getState())).toBe(true)
    })

    it('persists the parked state and none of the actions', async () => {
        const { useOnboardingStore, storage } = await loadStore()
        useOnboardingStore.getState().setPendingTemplateLink('kit')
        const saved = JSON.parse(storage.read(STORAGE_KEY)!).state
        expect(saved.pendingTemplateLink).toBe('kit')
        expect(Object.keys(saved).sort()).toEqual(['firstAgentFromPrompt', 'parkedAt', 'pendingFirstAgent', 'pendingShareLink', 'pendingTemplate', 'pendingTemplateLink'])
    })
})
