import type { CSSProperties } from 'react'

import type { ForemanCorner, ForemanPlacement } from '@/lib/foreman-layout'

/**
 * Les coins de la fenêtre flottante, à la même distance du bord visible que le mobilier du board
 * (1rem dans la carte, elle-même rentrée de --board-inset, et à gauche de --board-inset-left). En toutes lettres pour Tailwind, et en
 * classes plutôt qu'en pixels mesurés : le serveur rend la fenêtre déjà dans son coin.
 */
export const FLOAT_CORNER_CLASSES: Record<ForemanCorner, string> = {
    'top-left': 'md:top-[calc(1rem+var(--board-inset,0px))] md:left-[calc(1rem+var(--board-inset-left,0px))] md:origin-top-left',
    'top-right': 'md:top-[calc(1rem+var(--board-inset,0px))] md:right-[calc(1rem+var(--board-inset,0px))] md:origin-top-right',
    'bottom-left': 'md:bottom-[calc(1rem+var(--board-inset,0px)+var(--consent-inset))] md:left-[calc(1rem+var(--board-inset-left,0px))] md:origin-bottom-left',
    'bottom-right': 'md:bottom-[calc(1rem+var(--board-inset,0px)+var(--consent-inset))] md:right-[calc(1rem+var(--board-inset,0px))] md:origin-bottom-right',
}

/** La taille tirée, bornée par l'écran en CSS : une fenêtre rapetissée n'a rien à recalculer. */
export const FLOAT_SIZE_CLASSES =
    'md:w-(--foreman-float-w) md:h-(--foreman-float-h) md:max-w-[calc(100vw-2rem-var(--board-inset,0px)-var(--board-inset-left,0px))] md:max-h-[calc(100dvh-2rem-2*var(--board-inset,0px))]'

export function floatSizeStyle(placement: ForemanPlacement): CSSProperties {
    return { '--foreman-float-w': `${placement.width}px`, '--foreman-float-h': `${placement.height}px` } as CSSProperties
}
