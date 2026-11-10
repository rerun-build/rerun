'use client'

import type { AgentSharePreview } from '@rerun/contracts'
import { track } from '@rerun/analytics/client'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { ScrollFade } from '@rerun/ui/primitives'
import { getSharedAgentAction } from '@/app/api/_actions/agent-share.actions'
import { SharedAgentBoard } from '@/components/agent/share/SharedAgentBoard'
import { sharedAgentCardProps } from '@/components/agent/share/shared-agent-contents'
import { TemplateDetailAgentCard } from '@/components/templates/TemplateDetailAgentCard'
import { TemplateInstallSteps } from '@/components/templates/TemplateInstallSteps'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentShareCta } from '@/lib/agents/useAgentShareCta'
import { useAgentShareStore } from '@/stores/agent-share.store'
import { useSession } from '@/supabase/session/SessionProvider'

// The landing page of a share link, in the app. Same shape as TemplateDeepLinkDialog: one card,
// one decision. It is deliberately also what an anonymous visitor sees, ahead of the account wall,
// because a share link has no public page of its own to preview from.
export function AgentShareDeepLinkDialog({ token }: { token: string }) {
    const t = useTranslations('dialogs.agentShare')
    const preview = useAgentShareStore(s => s.preview)
    const closeLink = useAgentShareStore(s => s.closeLink)

    useEffect(() => {
        if (useAgentShareStore.getState().preview) return
        let cancelled = false
        void getSharedAgentAction(token).then(found => {
            if (cancelled) return
            if (!found) {
                toast.error(t('unavailable'))
                useAgentShareStore.getState().closeLink()
                return
            }
            useAgentShareStore.getState().resolveLink(found)
        })
        return () => {
            cancelled = true
        }
    }, [token, t])

    return (
        <Dialog open onOpenChange={open => !open && closeLink()}>
            <DialogContent className="gap-0 overflow-hidden p-0 max-sm:h-[85dvh] sm:max-w-lg">
                <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col sm:h-[min(52rem,92dvh)]">
                    {/* The panel already shows the title: this only exists for Radix, which requires
                        an accessible title and description on any dialog content. */}
                    <DialogHeader className="sr-only">
                        <DialogTitle>{preview ? t('titleNamed', { name: preview.agent.name }) : t('title')}</DialogTitle>
                        <DialogDescription>{t('description')}</DialogDescription>
                    </DialogHeader>
                    {preview ? <SharedAgentPanel token={token} preview={preview} onDone={closeLink} /> : <SharedAgentSkeleton />}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function SharedAgentPanel({ token, preview, onDone }: { token: string; preview: AgentSharePreview; onDone: () => void }) {
    const t = useTranslations('dialogs.agentShare')
    const { isAnonymous } = useSession()

    useEffect(() => {
        track('agent_share_opened', { has_account: !isAnonymous })
    }, [isAnonymous])

    const { comesWith, notes } = sharedAgentCardProps(preview)

    return (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            {/* The board is edge to edge and the text starts under it: it is the first thing on the
                only page this coworker has, and a picture framed inside the padding would read as an
                illustration of the card rather than as the agent itself. */}
            <ScrollFade className="min-h-0 flex-1">
                <SharedAgentBoard agent={preview.agent} connectors={preview.connectors} />
                <div className="flex flex-col gap-5 p-5">
                    <div className="space-y-1.5">
                        <h2 className="text-lg font-medium">{preview.agent.name}</h2>
                        <p className="text-sm text-muted-foreground">{preview.sharedBy ? t('sentBy', { name: preview.sharedBy }) : t('sentBySomeone')}</p>
                    </div>

                    <TemplateDetailAgentCard agent={preview.agent} connectors={preview.connectors} comesWith={comesWith} notes={notes} />
                </div>
            </ScrollFade>
            {isAnonymous ? <SignUpFooter /> : <InstallFooter token={token} preview={preview} onDone={onDone} />}
        </div>
    )
}

function InstallFooter({ token, preview, onDone }: { token: string; preview: AgentSharePreview; onDone: () => void }) {
    const cta = useAgentShareCta(token, preview, onDone)
    return (
        <div className="flex flex-col gap-3 border-t bg-muted/50 px-5 py-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {cta.steps.length > 1 && <TemplateInstallSteps steps={cta.steps} />}
            <Button className="w-full" loading={cta.pending} onClick={cta.run}>
                {cta.label}
            </Button>
            {cta.note && <p className="text-center text-xs text-muted-foreground">{cta.note}</p>}
        </div>
    )
}

// An anonymous visitor sees the card first and the wall second: the link is the only place this
// agent is described, so asking to sign up before showing it would be asking blind. Closing the
// card hands the screen back to the account wall, which is already mounted underneath.
function SignUpFooter() {
    const t = useTranslations('dialogs.agentShare')
    const closeLink = useAgentShareStore(s => s.closeLink)
    return (
        <div className="flex flex-col gap-3 border-t bg-muted/50 px-5 py-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button className="w-full" onClick={closeLink}>
                {t('signUp')}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t('waiting')}</p>
        </div>
    )
}

function SharedAgentSkeleton() {
    return (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
                <Skeleton className="aspect-[1200/630] w-full shrink-0 rounded-none" />
                <div className="flex flex-col gap-5 p-5">
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                    <Skeleton className="h-64 w-full rounded-lg" />
                </div>
            </div>
            <div className="border-t bg-muted/50 px-5 py-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <Skeleton className="h-9 w-full" />
            </div>
        </div>
    )
}
