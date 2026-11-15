import type { Matrix } from '@/components/orb/orb-motion'

export function stretchedFrom(y: number, scale: number): Matrix {
    'worklet'
    return [1, 0, 0, scale, 0, y * (1 - scale)]
}

export function liftedBy(dy: number): Matrix {
    'worklet'
    return [1, 0, 0, 1, 0, dy]
}
