export type Harmonic = { freq: number; amp: number; speed: number }

const TAU = Math.PI * 2

export const BLOB_HARMONICS: Harmonic[] = [
    { freq: 8, amp: 0.044, speed: 0.55 },
    { freq: 3, amp: 0.022, speed: -0.37 },
    { freq: 5, amp: 0.011, speed: 0.83 },
]

export type BlobSample = { harmonics: Harmonic[]; samples: number; radius: number; center: number; amp: number; phase: number }

function radiusAt(angle: number, { harmonics, radius, amp, phase }: BlobSample) {
    let r = 1
    for (const h of harmonics) r += h.amp * amp * Math.sin(h.freq * angle + h.speed * phase)
    return r * radius
}

export function blobPath(config: BlobSample) {
    const { samples, center } = config
    const points: [number, number][] = []
    for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * TAU
        const r = radiusAt(angle, config)
        points.push([center + Math.cos(angle) * r, center + Math.sin(angle) * r])
    }

    const at = (i: number) => points[(i + samples) % samples]
    let d = `M ${at(0)[0].toFixed(3)} ${at(0)[1].toFixed(3)}`
    for (let i = 0; i < samples; i++) {
        const [x0, y0] = at(i - 1)
        const [x1, y1] = at(i)
        const [x2, y2] = at(i + 1)
        const [x3, y3] = at(i + 2)
        const c1x = x1 + (x2 - x0) / 6
        const c1y = y1 + (y2 - y0) / 6
        const c2x = x2 - (x3 - x1) / 6
        const c2y = y2 - (y3 - y1) / 6
        d += ` C ${c1x.toFixed(3)} ${c1y.toFixed(3)} ${c2x.toFixed(3)} ${c2y.toFixed(3)} ${x2.toFixed(3)} ${y2.toFixed(3)}`
    }
    return `${d} Z`
}

export function approach(current: number, target: number, dt: number, rate = 3.2) {
    return current + (target - current) * (1 - Math.exp(-dt * rate))
}
