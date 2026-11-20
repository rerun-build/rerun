import { create } from 'zustand'
import type { KnowledgeBaseTab, WorkspaceDialogPanel } from '@/lib/settings/panels'
import type { Provider } from '@rerun/contracts'

// What a caller asks a dialog to land on, beyond opening it: a provider to sign back in, a table to
// browse, a provider to add. Read then cleared by the dialog it names, because the content it asks for only mounts on
// the next render — which is why it cannot be an argument.
type PanelFocus = { entryId?: string; connectionId?: string; reconnect?: boolean; addProvider?: Exclude<Provider, 'rerun'>; tab?: KnowledgeBaseTab; table?: string; view?: string; page?: string }

type WorkspaceSettingsState = {
    // One panel at a time: they are all modal dialogs over the same board.
    panel: WorkspaceDialogPanel | null
    focus: PanelFocus | null
    openWorkspacePanel: (panel: WorkspaceDialogPanel) => void
    openAiProviders: (connectionId?: string) => void
    reconnectAiProvider: (connectionId: string) => void
    addAiProvider: (provider: Exclude<Provider, 'rerun'>) => void
    openKnowledgeBase: (tab: KnowledgeBaseTab, table?: string, view?: string) => void
    openBrainPage: (slug: string) => void
    openVault: (entryId?: string) => void
    clearFocus: () => void
    setPanel: (panel: WorkspaceDialogPanel | null) => void
}

export const useWorkspaceSettingsStore = create<WorkspaceSettingsState>(set => ({
    panel: null,
    focus: null,
    // The menu never deep-links, so opening from it clears whatever a previous caller asked for.
    openWorkspacePanel: panel => set({ panel, focus: null }),
    openAiProviders: connectionId => set({ panel: 'ai_providers', focus: { connectionId } }),
    reconnectAiProvider: connectionId => set({ panel: 'ai_providers', focus: { connectionId, reconnect: true } }),
    addAiProvider: provider => set({ panel: 'ai_providers', focus: { addProvider: provider } }),
    openKnowledgeBase: (tab, table, view) => set({ panel: 'knowledge_base', focus: { tab, table, view } }),
    openBrainPage: slug => set({ panel: 'knowledge_base', focus: { tab: 'company', page: slug } }),
    openVault: entryId => set({ panel: 'vault', focus: entryId ? { entryId } : null }),
    clearFocus: () => set({ focus: null }),
    setPanel: panel => set({ panel, focus: null }),
}))
