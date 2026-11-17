'use client'

import type { JobEnd } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AgentWorkspaceMessage } from '@/components/chat/AgentWorkspaceMessage'
import { ThreadDividerDialog } from '@/components/chat/ThreadDividerDialog'
import { ThreadDividerDot, ThreadDividerLine, ThreadDividerLink } from '@/components/chat/ThreadDividerLine'
import { COMPUTER_HANDLE_CLASS } from '@/components/computers/ComputerBits'
import { TerminalIcon } from '@/lib/icons'

// The end of a job woke the coworker: a divider marks it, what the computer reported one click away.
export function JobEndBlock({ agentId, end }: { agentId: string | undefined; end: JobEnd }) {
    const t = useTranslations('chat.jobEnd')
    const tState = useTranslations('chat.computerJob.state')
    const [reportOpen, setReportOpen] = useState(false)

    return (
        <>
            <ThreadDividerLine icon={<TerminalIcon className="size-3.5" />}>
                <span>{t.rich('label', { handle: end.computer, computer: chunks => <span className={COMPUTER_HANDLE_CLASS}>{chunks}</span> })}</span>
                <ThreadDividerDot />
                {end.label && (
                    <>
                        <span className="min-w-0 truncate font-medium text-foreground">{end.label}</span>
                        <ThreadDividerDot />
                    </>
                )}
                {tState(end.state)}
                <ThreadDividerDot />
                <ThreadDividerLink onClick={() => setReportOpen(true)}>{t('viewReport')}</ThreadDividerLink>
            </ThreadDividerLine>
            <ThreadDividerDialog open={reportOpen} onOpenChange={setReportOpen} icon={TerminalIcon} title={t('reportTitle', { computer: end.computer })}>
                <AgentWorkspaceMessage agentId={agentId}>{end.report}</AgentWorkspaceMessage>
            </ThreadDividerDialog>
        </>
    )
}
