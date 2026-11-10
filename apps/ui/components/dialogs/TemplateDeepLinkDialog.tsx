'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { getSharedTemplateAction } from '@/app/api/_actions/template.actions'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { TemplateDetailPanel } from '@/components/templates/TemplateDetailPanel'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useTemplateFlowStore } from '@/stores/template-flow.store'

// La page d'atterrissage d'un lien de template. Elle remplace le wizard de recrutement à elle seule :
// rien à configurer, une seule décision. C'est exactement la fiche de la library, en une colonne, et
// c'est son footer partagé qui sait quelle porte le bouton franchit (plan, achat, placement).
export function TemplateDeepLinkDialog({ slug }: { slug: string }) {
    const t = useTranslations('dialogs.templateDeepLink')
    const template = useTemplateFlowStore(s => s.linkTemplate)
    const closeLink = useTemplateFlowStore(s => s.closeLink)
    const isAdmin = useIsAdmin()

    // La fiche charge sa propre template : c'est aussi ce qui la fait revenir intacte après un
    // checkout annulé, où seul le slug traverse.
    useEffect(() => {
        if (useTemplateFlowStore.getState().linkTemplate?.slug === slug) return
        let cancelled = false
        void getSharedTemplateAction(slug).then(found => {
            if (cancelled) return
            if (!found) {
                toast.error(t('unavailable'))
                useTemplateFlowStore.getState().closeLink()
                return
            }
            useTemplateFlowStore.getState().resolveLink(found)
        })
        return () => {
            cancelled = true
        }
    }, [slug, t])

    return (
        <Dialog open onOpenChange={open => !open && closeLink()}>
            <DialogContent className="gap-0 overflow-hidden p-0 max-sm:h-[85dvh] sm:max-w-lg">
                <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col sm:h-[min(52rem,92dvh)]">
                    {/* Le panneau affiche déjà le titre : celui-ci n'existe que pour Radix, qui exige
                        un titre et une description accessibles sur tout contenu de dialog. */}
                    <DialogHeader className="sr-only">
                        <DialogTitle>{template ? t('titleNamed', { title: template.title }) : t('title')}</DialogTitle>
                        <DialogDescription>{t('description')}</DialogDescription>
                    </DialogHeader>
                    {template ? <TemplateDetailPanel template={template} showStatus={isAdmin || template.isMine} onImported={closeLink} /> : <TemplateDetailSkeleton />}
                </div>
            </DialogContent>
        </Dialog>
    )
}

// Calqué sur TemplateDetailPanel : le média 16:9, le titre, le bloc meta et le bouton se trouvent
// déjà à leur place quand la template arrive.
function TemplateDetailSkeleton() {
    return (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
                <Skeleton className="aspect-video w-full shrink-0 rounded-none" />
                <div className="flex flex-col gap-5 p-5">
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                    <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-muted/30 p-3">
                        {['price', 'agents', 'connectors', 'setup', 'category'].map(row => (
                            <div key={row} className="flex items-center justify-between gap-4">
                                <Skeleton className="h-3 w-16" />
                                <Skeleton className="h-3 w-10" />
                            </div>
                        ))}
                    </div>
                    <div className="space-y-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-5/6" />
                    </div>
                </div>
            </div>
            <div className="border-t bg-muted/50 px-5 py-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <Skeleton className="h-9 w-full" />
            </div>
        </div>
    )
}
