'use client'

import { useErrorText } from '@/hooks/useErrorText'
import * as React from 'react'
import { toast } from 'sonner'
import { Badge } from '@rerun/ui/primitives'
import { listAgentSharesAction, revokeAgentShareAction } from '@/app/api/_actions/agent-share.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { PanelRow } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { CheckIcon, CopyIcon, Trash2Icon } from '@/lib/icons'
import type { WorkspaceShare } from '@/lib/agents/share-read'
import { useCopy } from '@/lib/use-copy'
import { useTranslations } from 'next-intl'

// A link has no expiry, so revoking is the only way it ever ends: it has to be reachable from the
// agent it came from, not only from the dialog that created it.
export function SharedLinksSection({ agentId }: { agentId: string }) {
    const [shares, setShares] = React.useState<WorkspaceShare[] | null>(null)
    const canManage = useCanManageAgent(agentId)
    const t = useTranslations('agent.sharedLinksSection')
    const errorText = useErrorText()
    const tShared = useTranslations('agent.modelsShared')

    React.useEffect(() => {
        let cancelled = false
        void listAgentSharesAction().then(result => {
            // Filtered on the id rather than the name: two agents can share a name, and the name on
            // a link is the one frozen when it was made.
            if (!cancelled) setShares(result.ok ? result.shares.filter(share => share.sourceAgentId === agentId) : [])
        })
        return () => {
            cancelled = true
        }
    }, [agentId])

    async function revoke(shareId: string) {
        const result = await revokeAgentShareAction(shareId)
        if (!result.ok) {
            toast.error(t('revokeFailed'), { description: errorText(result) })
            return
        }
        setShares(current => (current ?? []).filter(share => share.id !== shareId))
        toast.success(t('revoked'), { description: t('revokedDescription') })
    }

    if (shares === null) return <Skeleton className="h-14 w-full" />
    if (shares.length === 0) return null

    return (
        <Field label={t('label')} helperText={t('helper')}>
            <div className="flex flex-col gap-2">
                {shares.map(share => (
                    <ShareRow key={share.id} share={share} revokeDisabledReason={canManage ? undefined : tShared('boxManageReason')} onRevoke={() => revoke(share.id)} />
                ))}
            </div>
        </Field>
    )
}

function ShareRow({ share, revokeDisabledReason, onRevoke }: { share: WorkspaceShare; revokeDisabledReason?: string; onRevoke: () => void }) {
    const { copied, copy } = useCopy()
    const t = useTranslations('agent.sharedLinksSection')
    const carried = (['memories', 'database', 'files'] as const).filter(bucket => share.include[bucket]).map(bucket => t(`carried.${bucket}`))

    return (
        <PanelRow
            title={share.installCount === 0 ? t('notUsed') : t('added', { count: share.installCount })}
            description={carried.length === 0 ? t('agentOnly') : undefined}
            meta={carried.length > 0 ? carried.map(label => <Badge key={label} tone="orange">{label}</Badge>) : undefined}
            actions={
                <>
                    <Button size="icon-sm" variant="ghost" aria-label={t('copy')} onClick={() => copy(share.url)}>
                        {copied ? <CheckIcon className="size-3.5 text-emerald-500" /> : <CopyIcon className="size-3.5" />}
                    </Button>
                    <TooltipDisabledReason reason={revokeDisabledReason}>
                        <ConfirmDialog
                            title={t('revokeTitle')}
                            description={t('revokeDescription')}
                            confirmLabel={t('revoke')}
                            onConfirm={onRevoke}
                        >
                            <Button size="icon-sm" variant="ghost" aria-label={t('revokeLabel')} disabled={!!revokeDisabledReason} className="text-destructive hover:text-destructive">
                                <Trash2Icon className="size-3.5" />
                            </Button>
                        </ConfirmDialog>
                    </TooltipDisabledReason>
                </>
            }
        />
    )
}
