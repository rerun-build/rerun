'use client'

import { useBoxExplainerWalk } from '@/components/dialogs/useBoxExplainerWalk'
import { TourScene } from '@rerun/ui/tour'

export function BoxExplainerScene({ band, className }: { band: number; className?: string }) {
    const phase = useBoxExplainerWalk()

    return <TourScene phase={phase} active wide connectors={false} bandBottom={band} className={className} />
}
