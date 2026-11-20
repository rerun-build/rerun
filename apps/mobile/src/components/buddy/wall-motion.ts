import type { Matrix } from '@/components/orb/orb-motion'

// How the parts of a buddy move, as matrices in the units of its drawing: `layerTransform` turns one
// into the transform of the view that carries the part.

// Stretched vertically by `scale`, the line `y` staying where it is.
export function stretchedFrom(y: number, scale: number): Matrix {
    'worklet'
    return [1, 0, 0, scale, 0, y * (1 - scale)]
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
