'use client'

import { BoxExplainerScene } from '@/components/dialogs/BoxExplainerScene'
import { ExplainerCheck } from '@/components/dialogs/ExplainerPanel'
import { useRenderedFrame } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import type { CSSProperties } from 'react'

// Four lines, not four paragraphs: on two columns a cell is about 280px wide, and the sentences the
// single column afforded would run five lines each. What carries the argument here is the scene
// above them, the copy only names what is being looked at.
const SPACE_CHECKPOINTS = ['room', 'home', 'shared', 'free'] as const

// The panel's own surface, stated once and opaque. It is what `bg-muted/30` resolves to over the
// dialog's `bg-popover`, and it is written out rather than left to the utility because the scrim
// under the copy has to start on exactly that colour: two independent expressions of the same
// surface drift apart in one theme or the other, and the seam shows.
const SURFACE = 'color-mix(in oklab, var(--muted) 30%, var(--popover))'
// Read on this element and not on :root, so `--muted` and `--popover` resolve against the theme
// island the dialog actually sits in.
const PANEL_STYLE = { '--box-panel-surface': SURFACE, background: 'var(--box-panel-surface)' } as CSSProperties
// A scrim laid over the scene rather than a mask cut into it: the plateau comes back up underneath
// the words, so the copy reads as laid on the board instead of the board stopping short of it.
// Colours are mixed rather than run to `transparent` so the ramp does not dip through grey.
const COPY_SCRIM = `linear-gradient(to top, var(--box-panel-surface) 0px, color-mix(in oklab, var(--box-panel-surface) 76%, transparent) 60%, color-mix(in oklab, var(--box-panel-surface) 0%, transparent) 100%)`

// Right-hand panel shared by the create/claim Box dialogs.
export function SpaceExplainer() {
    // The copy band is measured rather than pinned to a constant: it is what the scene's framing
    // subtracts, and a number written twice stops being true the first time the wording changes.
    // The scene waits for it, because a camera posed on the wrong frame is never revisited.
    const t = useTranslations('dialogs.boxExplainer')
    const { ref, frame } = useRenderedFrame()

    return (
        <div className="relative hidden overflow-hidden border-l sm:flex sm:flex-col" style={PANEL_STYLE}>
            {frame && <BoxExplainerScene band={frame.height} className="absolute inset-0" />}

            <div ref={ref} className="relative mt-auto px-8 pt-16 pb-8" style={{ backgroundImage: COPY_SCRIM }}>
                <h3 className="mb-5 text-lg font-medium">{t('title')}</h3>
                <ul className="grid grid-cols-2 gap-x-5 gap-y-4">
                    {SPACE_CHECKPOINTS.map(point => (
                        <li key={point} className="flex items-start gap-3">
                            <ExplainerCheck />
                            <div className="min-w-0">
                                <p className="text-sm font-medium">{t(`points.${point}.label`)}</p>
                                <p className="text-sm text-muted-foreground">{t(`points.${point}.description`)}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}
