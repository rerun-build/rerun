'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExpertProfileWizard, type OwnerExpert } from '@rerun/ui/experts'
import { Spinner } from '@rerun/ui/primitives'

import {
    getMyExpertProfileAction,
    updateMyExpertProfileAction,
    uploadMyExpertAvatarAction,
    uploadMyExpertBannerAction,
} from '@/app/api/_actions/expert-profile.actions'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { StepDialogHeader } from '@/components/dialogs/StepDialogHeader'
import { UserRoundIcon } from '@/lib/icons'

type Loaded = { expert: OwnerExpert; bannerOptions: string[] }

export function ExpertProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.expertProfile')
    const errorText = useErrorText()
    const [loaded, setLoaded] = useState<Loaded | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open || loaded || error) return
        let cancelled = false
        getMyExpertProfileAction().then(result => {
            if (cancelled) return
            if (result.ok) setLoaded({ expert: result.expert, bannerOptions: result.bannerOptions })
            else setError(errorText(result))
        })
        return () => {
            cancelled = true
        }
    }, [open, loaded, error, errorText])

    // Dropped on close so the next open refetches: a save rewrites the row, and a cached copy would
    // come back stale.
    function handleOpenChange(next: boolean) {
        if (!next) {
            setLoaded(null)
            setError(null)
        }
        onOpenChange(next)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="gap-0 overflow-hidden p-0 sm:max-w-5xl">
                {loaded ? (
                    <ExpertProfileWizard
                        expert={loaded.expert}
                        bannerOptions={loaded.bannerOptions}
                        uploadAvatar={uploadMyExpertAvatarAction}
                        uploadBanner={uploadMyExpertBannerAction}
                        submitLabel={t('submit')}
                        submittingLabel={t('submitting')}
                        renderHeader={header => <StepDialogHeader icon={UserRoundIcon} {...header} />}
                        onSubmit={async values => {
                            const result = await updateMyExpertProfileAction(values)
                            if (result.ok) {
                                toast.success(t('saved'))
                                handleOpenChange(false)
                            }
                            return result
                        }}
                    />
                ) : (
                    <div className="flex h-[24rem] items-center justify-center sm:h-[min(36rem,88dvh)]">
                        <DialogTitle className="sr-only">{t('title')}</DialogTitle>
                        {error ? <p className="px-6 text-center text-sm text-destructive">{error}</p> : <Spinner className="size-5 text-muted-foreground" />}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
