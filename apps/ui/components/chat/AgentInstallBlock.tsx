'use client'

import { AgentWorkspaceMessage } from '@/components/chat/AgentWorkspaceMessage'
import { ThreadDividerDialog } from '@/components/chat/ThreadDividerDialog'
import { ThreadDividerDot, ThreadDividerLine, ThreadDividerLink } from '@/components/chat/ThreadDividerLine'
import { Box3Icon, CheckCircle2Icon } from '@/lib/icons'
import { useBoardStore } from '@/stores/board.store'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function AgentInstallBlock({ agentId, agentName, guide, installing = false }: { agentId: string | undefined; agentName: string; guide: string; installing?: boolean }) {
    const t = useTranslations('chat.agentInstall')
    const liveName = useBoardStore(s => s.agents.find(agent => agent.id === agentId)?.name)
    const [guideOpen, setGuideOpen] = useState(false)

    return (
        <>
            <ThreadDividerLine flowing={installing} icon={installing ? <Box3Icon className="size-3.5" /> : <CheckCircle2Icon className="size-3.5 text-emerald-500" />}>
                {installing ? t('started') : t('complete')}
                <ThreadDividerDot />
                <ThreadDividerLink onClick={() => setGuideOpen(true)}>{t('viewGuide')}</ThreadDividerLink>
            </ThreadDividerLine>
            <ThreadDividerDialog open={guideOpen} onOpenChange={setGuideOpen} icon={<Box3Icon className="size-3.5 text-muted-foreground" />} title={t('guideTitle', { name: liveName ?? agentName })}>
                <AgentWorkspaceMessage agentId={agentId}>{guide}</AgentWorkspaceMessage>
            </ThreadDividerDialog>
        </>
    )
}
