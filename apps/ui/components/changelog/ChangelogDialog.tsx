'use client'

import { StepTransition, useStepper } from '@rerun/ui/steps'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { landingUrl } from '@/lib/site'
import { useChangelogStore } from '@/stores/changelog.store'
import { ChangelogDots } from './ChangelogDots'
import { ChangelogEntrySlide } from './ChangelogEntrySlide'
import { ChangelogEntryVisual } from './ChangelogEntryVisual'

export function ChangelogDialog() {
    const open = useChangelogStore(state => state.open)
    const shown = useChangelogStore(state => state.shown)
    const close = useChangelogStore(state => state.close)

    if (!open || shown.length === 0) return null
    return (
        <Dialog open onOpenChange={next => !next && close()}>
            <ChangelogSteps key={shown[0]?.id} />
        </Dialog>
    )
}

function ChangelogSteps() {
    const t = useTranslations('changelog')
    const shown = useChangelogStore(state => state.shown)
    const close = useChangelogStore(state => state.close)
    const { index, direction, isFirst, isLast, goForward, back } = useStepper(shown.length)
    const entry = shown[index]
    const next = shown[index + 1]

    // Sans ça, « Next » ouvre sur un cadre vide le temps que l'image arrive.
    useEffect(() => {
        for (const url of [next?.imageUrl, next?.imageDarkUrl]) {
            if (url) new Image().src = url
        }
    }, [next?.imageUrl, next?.imageDarkUrl])

    if (!entry) return null
    return (
        // Plus petite que le cadre maison : une annonce se lit, elle ne se remplit pas. La hauteur suit
        // la largeur pour que la colonne de droite garde le 5:6 du visuel.
        <SplitDialogContent
            aside={<ChangelogEntryVisual entry={entry} direction={direction} />}
            className="sm:max-w-[min(64rem,100%_-_4rem)]"
            gridClassName="sm:h-[min(38.5rem,90dvh)]"
        >
            <div className="flex min-h-0 flex-col p-6 sm:p-8">
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <StepTransition stepKey={entry.id} direction={direction}>
                        <ChangelogEntrySlide entry={entry} />
                    </StepTransition>
                </div>
                <DialogFooter className="-mx-6 mt-auto -mb-6 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t bg-muted/50 px-6 py-4 sm:-mx-8 sm:-mb-8 sm:justify-between sm:px-8">
                    <ChangelogDots count={shown.length} current={index} />
                    <a href={landingUrl('/changelog')} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                        {t('seeAll')}
                    </a>
                    <div className="ml-auto flex items-center gap-2">
                        {!isFirst && (
                            <Button variant="ghost" onClick={back}>
                                {t('back')}
                            </Button>
                        )}
                        <Button onClick={() => (isLast ? close() : goForward())}>{isLast ? t('done') : t('next')}</Button>
                    </div>
                </DialogFooter>
            </div>
        </SplitDialogContent>
    )
}
