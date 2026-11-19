'use client'

import { BoxExplainerScene } from '@/components/dialogs/BoxExplainerScene'
import { ExplainerCheck } from '@/components/dialogs/ExplainerPanel'
import { useRenderedFrame } from '@moldwright/ui/iso-grid'
import { useTranslations } from 'next-intl'
import type { CSSProperties } from 'react'

const SPACE_CHECKPOINTS = ['room', 'home', 'shared', 'free'] as const

const SURFACE = 'color-mix(in oklab, var(--muted) 30%, var(--popover))'
const PANEL_STYLE = { '--box-panel-surface': SURFACE, background: 'var(--box-panel-surface)' } as CSSProperties
const COPY_SCRIM = `linear-gradient(to top, var(--box-panel-surface) 0px, color-mix(in oklab, var(--box-panel-surface) 76%, transparent) 60%, color-mix(in oklab, var(--box-panel-surface) 0%, transparent) 100%)`

export function SpaceExplainer() {
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
