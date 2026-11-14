import type { CSSProperties } from 'react'

import type { ForemanCorner, ForemanPlacement } from '@/lib/foreman-layout'

export const FLOAT_CORNER_CLASSES: Record<ForemanCorner, string> = {
    'top-left': 'md:top-[calc(1rem+var(--board-inset,0px))] md:left-[calc(1rem+var(--board-inset,0px))] md:origin-top-left',
    'top-right': 'md:top-[calc(1rem+var(--board-inset,0px))] md:right-[calc(1rem+var(--board-inset,0px))] md:origin-top-right',
    'bottom-left': 'md:bottom-[calc(1rem+var(--board-inset,0px)+var(--consent-inset))] md:left-[calc(1rem+var(--board-inset,0px))] md:origin-bottom-left',
    'bottom-right': 'md:bottom-[calc(1rem+var(--board-inset,0px)+var(--consent-inset))] md:right-[calc(1rem+var(--board-inset,0px))] md:origin-bottom-right',
}

export const FLOAT_SIZE_CLASSES =
    'md:w-(--foreman-float-w) md:h-(--foreman-float-h) md:max-w-[calc(100vw-2rem-2*var(--board-inset,0px))] md:max-h-[calc(100dvh-2rem-2*var(--board-inset,0px))]'

export function floatSizeStyle(placement: ForemanPlacement): CSSProperties {
    return { '--foreman-float-w': `${placement.width}px`, '--foreman-float-h': `${placement.height}px` } as CSSProperties
}
