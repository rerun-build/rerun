'use client'

import { useResolvedIsMobile } from '@rerun/ui/primitives/use-is-mobile'
import { AuthStageBoard } from './AuthStageBoard'

const centerScrim =
    'radial-gradient(ellipse 30% 44% at 50% 50%, var(--background) 56%, color-mix(in oklab, var(--background) 55%, transparent) 82%, transparent 100%)'

const veil = 'color-mix(in oklab, var(--background) 50%, transparent)'

const DIALOG_STAGE_WIDTH = '64rem'

export function AuthScene({ variant = 'page' }: { variant?: 'page' | 'dialog' }) {
    const isMobile = useResolvedIsMobile()
    if (isMobile !== false) return null

    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2" style={{ width: variant === 'dialog' ? DIALOG_STAGE_WIDTH : '100%' }}>
                <AuthStageBoard />
                <div className="absolute inset-0" style={{ background: veil }} />
                <div className="absolute inset-0" style={{ backgroundImage: centerScrim }} />
            </div>
        </div>
    )
}
