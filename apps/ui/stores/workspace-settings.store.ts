import { create } from 'zustand'
import type { KnowledgeBaseTab, WorkspaceDialogPanel } from '@/lib/settings/panels'
import type { Provider } from '@rerun/contracts'

type PanelFocus = { connectionId?: string; reconnect?: boolean; addProvider?: Exclude<Provider, 'rerun'>; tab?: KnowledgeBaseTab; table?: string; view?: string; page?: string }

type WorkspaceSettingsState = {
    panel: WorkspaceDialogPanel | null
    focus: PanelFocus | null
    openWorkspacePanel: (panel: WorkspaceDialogPanel) => void
    openAiProviders: (connectionId?: string) => void
    reconnectAiProvider: (connectionId: string) => void
    addAiProvider: (provider: Exclude<Provider, 'rerun'>) => void
    openKnowledgeBase: (tab: KnowledgeBaseTab, table?: string, view?: string) => void
    openBrainPage: (slug: string) => void
    clearFocus: () => void
    setPanel: (panel: WorkspaceDialogPanel | null) => void
}

export const useWorkspaceSettingsStore = create<WorkspaceSettingsState>(set => ({
    panel: null,
    focus: null,
    openWorkspacePanel: panel => set({ panel, focus: null }),
    openAiProviders: connectionId => set({ panel: 'ai_providers', focus: { connectionId } }),
    reconnectAiProvider: connectionId => set({ panel: 'ai_providers', focus: { connectionId, reconnect: true } }),
    addAiProvider: provider => set({ panel: 'ai_providers', focus: { addProvider: provider } }),
    openKnowledgeBase: (tab, table, view) => set({ panel: 'knowledge_base', focus: { tab, table, view } }),
    openBrainPage: slug => set({ panel: 'knowledge_base', focus: { tab: 'company', page: slug } }),
    clearFocus: () => set({ focus: null }),
    setPanel: panel => set({ panel, focus: null }),
}))
