import type { Matrix } from '@/components/orb/orb-motion'

// Animated groups only take a `matrix`: react-native-svg turns the shorthands (scaleY, originY,
// translateY) into one in JS, which a prop driven by Reanimated never goes through.

// Stretched vertically by `scale`, the line `y` staying where it is.
export function stretchedFrom(y: number, scale: number): Matrix {
    'worklet'
    return [1, 0, 0, scale, 0, y * (1 - scale)]
}

export function liftedBy(dy: number): Matrix {
    'worklet'
    return [1, 0, 0, 1, 0, dy]
}

// What `inner` then `outer` do, as one matrix.
export function multiplied(outer: Matrix, inner: Matrix): Matrix {
    'worklet'
    const [a, b, c, d, e, f] = outer
    return [a * inner[0] + c * inner[1], b * inner[0] + d * inner[1], a * inner[2] + c * inner[3], b * inner[2] + d * inner[3], a * inner[4] + c * inner[5] + e, b * inner[4] + d * inner[5] + f]
}

export function inverted([a, b, c, d, e, f]: Matrix): Matrix {
    'worklet'
    const det = a * d - b * c
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

export function svgTransform(matrix: Matrix) {
    return `matrix(${matrix.join(' ')})`
}
