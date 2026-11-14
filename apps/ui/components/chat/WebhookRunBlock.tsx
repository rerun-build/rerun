'use client'

import { AgentWorkspaceMessage } from '@/components/chat/AgentWorkspaceMessage'
import { ThreadDividerDialog } from '@/components/chat/ThreadDividerDialog'
import { ThreadDividerDot, ThreadDividerLine, ThreadDividerLink } from '@/components/chat/ThreadDividerLine'
import { TriggerPayloadDetails, TriggerPayloadSummary } from '@/components/chat/TriggerPayloadBlock'
import { WebhookIcon } from '@/lib/icons'
import { type TriggerPayload } from '@/lib/triggers/trigger-payload'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type OpenDialog = 'prompt' | 'payload' | null

// The webhook speaks, not the user: a divider marks where it fired, with its prompt and what the
// caller sent each one click away.
export function WebhookRunBlock({ agentId, payload }: { agentId: string | undefined; payload: TriggerPayload }) {
    const t = useTranslations('chat.webhookRun')
    const [openDialog, setOpenDialog] = useState<OpenDialog>(null)
    const closeOn = (dialog: Exclude<OpenDialog, null>) => (open: boolean) => setOpenDialog(open ? dialog : null)

    return (
        <>
            <ThreadDividerLine icon={<WebhookIcon className="size-3.5" />}>
                {t('label')}
                <ThreadDividerDot />
                <span className="min-w-0 truncate font-medium text-foreground">{payload.slug}</span>
                {payload.prompt && (
                    <>
                        <ThreadDividerDot />
                        <ThreadDividerLink onClick={() => setOpenDialog('prompt')}>{t('viewPrompt')}</ThreadDividerLink>
                    </>
                )}
                <ThreadDividerDot />
                <ThreadDividerLink onClick={() => setOpenDialog('payload')}>{t('viewPayload')}</ThreadDividerLink>
            </ThreadDividerLine>
            <ThreadDividerDialog open={openDialog === 'prompt'} onOpenChange={closeOn('prompt')} icon={WebhookIcon} title={t('promptTitle', { name: payload.slug })}>
                <AgentWorkspaceMessage agentId={agentId}>{payload.prompt}</AgentWorkspaceMessage>
            </ThreadDividerDialog>
            <ThreadDividerDialog
                open={openDialog === 'payload'}
                onOpenChange={closeOn('payload')}
                icon={WebhookIcon}
                title={t('payloadTitle', { name: payload.slug })}
                aside={
                    <span className="flex shrink-0 items-center gap-2">
                        <TriggerPayloadSummary payload={payload} />
                    </span>
                }
            >
                <TriggerPayloadDetails payload={payload} bodyClassName="max-h-none bg-muted" />
            </ThreadDividerDialog>
        </>
    )
}
