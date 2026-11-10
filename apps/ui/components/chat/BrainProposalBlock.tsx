'use client'

import { BrainIcon } from '@/lib/icons'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { Button, Icon } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

// What an agent leaves in the conversation when it proposes a change to the company brain. The
// decision itself happens in the Brain, next to every other pending change and its diff.
export function BrainProposalBlock({ title, mode }: { title: string; mode: 'create' | 'edit' }) {
    const t = useTranslations('chat.brainProposal')
    const openKnowledgeBase = useWorkspaceSettingsStore(s => s.openKnowledgeBase)

    return (
        <div className="rounded-xl bg-muted/30 px-1.5 py-1.5">
            <div className="flex items-center gap-3 text-sm">
                <Icon size="sm" icon={BrainIcon} />
                <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{mode === 'create' ? t('create', { title }) : t('edit', { title })}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t('description')}</span>
                </div>
                <Button size="xs" variant="ghost" onClick={() => openKnowledgeBase('proposals')}>
                    {t('review')}
                </Button>
            </div>
        </div>
    )
}
