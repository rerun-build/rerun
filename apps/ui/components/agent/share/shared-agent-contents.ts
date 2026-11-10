import type { AgentSharePreview } from '@rerun/contracts'
import type { AgentCardEntry, AgentCardNotes } from '@/components/templates/TemplateDetailAgentCard'
import { BoxIcon, BrainIcon, DatabaseIcon, FileTextIcon, KeyIcon, PlugIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

// What the recipient gets, and what stays on them, told inside the agent card rather than in a box
// of its own underneath: these are properties of this copy, on the same footing as its skills.
export function useSharedAgentCardProps(preview: AgentSharePreview): { comesWith: AgentCardEntry[]; notes: AgentCardNotes } {
    const t = useTranslations('agent.sharedAgentContents')
    const { include, contents } = preview

    const comesWith: AgentCardEntry[] = [
        include.memories && contents.memories.count > 0 ? { key: 'memories', icon: BrainIcon, title: t('memories', { count: contents.memories.count }), subtitle: t('memoriesSubtitle') } : null,
        include.database && contents.database.count > 0 ? { key: 'database', icon: DatabaseIcon, title: t('database'), subtitle: t('databaseSubtitle') } : null,
        include.files && contents.files.count > 0 ? { key: 'files', icon: FileTextIcon, title: t('files', { count: contents.files.count }) } : null,
        preview.envKeyCount > 0 ? { key: 'keys', icon: KeyIcon, title: t('keys', { count: preview.envKeyCount }), subtitle: t('keysSubtitle') } : null,
        preview.mcpAuthCount > 0 ? { key: 'mcp-auth', icon: PlugIcon, title: t('mcpAuth', { count: preview.mcpAuthCount }), subtitle: t('mcpAuthSubtitle') } : null,
    ].filter((entry): entry is AgentCardEntry => entry !== null)

    return {
        // An empty section would read as an omission rather than as an answer, and "no data" is the
        // most reassuring thing this card can say to someone opening a stranger's link.
        comesWith: comesWith.length > 0 ? comesWith : [{ key: 'agent-only', icon: BoxIcon, title: t('agentOnly'), subtitle: t('agentOnlySubtitle') }],
        notes: {
            connectors: preview.connectors.length > 0 ? t('connectorsNote') : undefined,
            triggers: preview.agent.triggers.length > 0 ? t('triggersNote') : undefined,
        },
    }
}

// The name AgentShareDeepLinkDialog still calls, unconditionally in its render body: a hook under its
// old name until that dialog switches to useSharedAgentCardProps.
export const sharedAgentCardProps = useSharedAgentCardProps
