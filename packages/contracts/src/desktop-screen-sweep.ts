function hash(x: number, y: number, z: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177)
    h = Math.imul(h ^ (h >>> 13), 1103515245)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const smoothstep = (from: number, to: number, value: number) => {
    const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
    return t * t * (3 - 2 * t)
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t

function noise(x: number, y: number, z: number): number {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const z0 = Math.floor(z)
    const tx = smoothstep(0, 1, x - x0)
    const ty = smoothstep(0, 1, y - y0)
    const tz = smoothstep(0, 1, z - z0)
    const slice = (zi: number) =>
        mix(mix(hash(x0, y0, zi), hash(x0 + 1, y0, zi), tx), mix(hash(x0, y0 + 1, zi), hash(x0 + 1, y0 + 1, zi), tx), ty)
    return mix(slice(z0), slice(z0 + 1), tz)
}

const shade = (col: number, row: number) => 0.45 + 0.55 * hash(col, row, 7)

const clusters = (col: number, row: number, seconds: number) => smoothstep(0.56, 0.8, noise(col / 4.5 + seconds * 0.12, row / 4.5 - seconds * 0.05, seconds * 0.2))

const SWEEP_PERIOD_SECONDS = 3.2
const SWEEP_BAND = 0.14
const CLUSTER_STRENGTH = 0.3

export function sweepIntensity(col: number, row: number, seconds: number, cols: number, rows: number): number {
    const along = (col + row) / (cols + rows)
    const front = ((seconds / SWEEP_PERIOD_SECONDS) % 1) * (1 + 2 * SWEEP_BAND) - SWEEP_BAND
    const band = smoothstep(0, 1, 1 - Math.abs(along - front) / SWEEP_BAND)
    return Math.max(band, clusters(col, row, seconds) * CLUSTER_STRENGTH) * shade(col, row)
}
