'use client'

import { Orb } from '@/components/foreman/Orb'
import { SignInPillButton } from '@/components/layout/SignInPill'
import { CanvasViewControls } from '@rerun/ui'
import { IsoGrid } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'

const noop = () => {}

// The app the onboarding dialog opens over: the empty board with its pill and its view controls, the
// Chief of Staff's column beside it. Only ever seen under the dialog's blurred overlay, so it is the
// real chrome on an empty board with nothing wired.
export function AppBackdrop() {
    const t = useTranslations('onboarding.site')
    return (
        <div aria-hidden className="fixed inset-0 flex gap-2 bg-muted/40 p-2">
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border bg-background">
                <IsoGrid tiles={[]} containers={[]} liveLinks={[]} canDraw={false} scrollGestures={false} />
                <div className="absolute top-3 left-3 z-40">
                    <SignInPillButton />
                </div>
                <CanvasViewControls placement="top-right" onZoomIn={noop} onZoomOut={noop} onRecenter={noop} />
            </div>
            <div className="hidden w-[30%] max-w-md shrink-0 flex-col rounded-xl border bg-background p-4 md:flex">
                <Orb size={28} state="idle" />
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                    <Orb size={72} state="idle" />
                    <p className="text-lg font-medium">{t('title')}</p>
                    <p className="text-sm text-muted-foreground">{t('description')}</p>
                </div>
                <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
                    <div className="h-9 rounded-md border bg-background" />
                    <div className="flex justify-end">
                        <div className="h-8 w-14 rounded-md bg-foreground" />
                    </div>
                </div>
            </div>
        </div>
    )
}
