import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { AppText } from '@/components/ui/AppText'
import { useWorkspaceAgents } from '@/data/useWorkspaceAgents'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

// The web's tab names (apps/ui/lib/board/types.ts) a pick may ask for, in English as the model writes
// them; the phone opens the ones it has.
const TAB_LABELS: Record<string, string> = { chat: 'Chat', actions: 'To handle', services: 'Apps', mcp: 'MCP', skills: 'Skills', data: 'Database', memories: 'Knowledge', files: 'Files', scheduled: 'Routines', triggers: 'Triggers' }
const PHONE_SCREENS: Record<string, 'apps' | 'files' | 'routines'> = { services: 'apps', mcp: 'apps', files: 'files', scheduled: 'routines', triggers: 'routines' }

export type AgentPick = { agentId: string; tab: string | null; conversationId: string | null }

function textOf(entry: object, key: string): string | null {
    const value = (entry as Record<string, unknown>)[key]
    return typeof value === 'string' && value ? value : null
}

function resolveTab(value: string): string | null {
    const wanted = value.trim().toLowerCase()
    return Object.entries(TAB_LABELS).find(([id, label]) => id === wanted || label.toLowerCase() === wanted)?.[0] ?? null
}

// Tolerant on purpose, like the web's `readAgentPicks`: the call is drawn while it streams, so the
// array and its last entry can be half written.
export function readAgentPicks(toolName: string, input: unknown): AgentPick[] {
    const entries = toolName === 'open_connector_setup' ? [{ ...(input as object), tab: 'services' }] : input && typeof input === 'object' ? (input as { agents?: unknown }).agents : undefined
    if (!Array.isArray(entries)) return []
    return entries.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return []
        const agentId = textOf(entry, 'agentId')
        if (!agentId) return []
        const tab = textOf(entry, 'tab')
        return [{ agentId, tab: tab ? resolveTab(tab) : null, conversationId: textOf(entry, 'conversationId') }]
    })
}

function open({ agentId, tab, conversationId }: AgentPick) {
    const screen = tab ? PHONE_SCREENS[tab] : undefined
    if (screen) router.push({ pathname: `/coworker/[id]/${screen}`, params: { id: agentId } })
    else router.push({ pathname: '/chat/[id]', params: { id: conversationId ?? 'new', to: agentId } })
}

/**
 * The Foreman's shortcut to the coworkers it talks about: one chip per coworker, opening its chat or
 * the screen it named. Names come from the workspace, not from the model's arguments, so a made-up or
 * deleted coworker drops out.
 */
export function AgentPickerCard({ picks }: { picks: AgentPick[] }) {
    const t = useTranslations('mobileCards')
    const theme = useTheme()
    const agents = useWorkspaceAgents()

    const rows = picks.flatMap(pick => {
        const agent = agents?.find(entry => entry.id === pick.agentId)
        return agent ? [{ pick, agent }] : []
    })
    if (rows.length === 0) return null

    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {rows.map(({ pick, agent }) => (
                <Pressable
                    key={`${pick.agentId}:${pick.tab ?? ''}`}
                    onPress={() => open(pick)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', height: 36, paddingLeft: spacing.sm, paddingRight: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.muted : theme.card })}
                >
                    <AgentBuddy agentId={agent.id} size={20} mood={agent.disabledAt ? 'asleep' : 'idle'} animated={false} facing="right" />
                    <AppText variant="footnote" medium numberOfLines={1} style={{ flexShrink: 1, color: agent.disabledAt ? theme.mutedForeground : theme.foreground }}>
                        {pick.tab ? t('agentPicker.open', { tab: pick.tab, name: agent.name }) : agent.name}
                    </AppText>
                </Pressable>
            ))}
        </View>
    )
}
