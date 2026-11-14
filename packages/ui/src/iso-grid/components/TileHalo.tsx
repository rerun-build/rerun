'use client'

const HEIGHT = 'var(--iso-halo-wall, 1.2)'
const PERIOD = 'var(--iso-halo-period, 2000ms)'
const SKEW = 26.565

export type HaloSide = 'back' | 'front'

const WALLS = [
    { key: 'north-west', side: 'back', x: 0, y: 0.5, skew: -SKEW, tone: 1 },
    { key: 'north-east', side: 'back', x: 0.5, y: 0, skew: SKEW, tone: 0.85 },
    { key: 'south-west', side: 'front', x: 0, y: 0.5, skew: SKEW, tone: 0.9 },
    { key: 'south-east', side: 'front', x: 0.5, y: 1, skew: -SKEW, tone: 0.72 },
] as const satisfies readonly { key: string; side: HaloSide; x: number; y: number; skew: number; tone: number }[]

const INTENSITY = 'var(--iso-halo-intensity, 0.5)'

const body = (color: string, tone: number) => {
    const sole = `color-mix(in srgb, ${color} min(100%, calc(100% * ${INTENSITY} * ${tone})), transparent)`
    const plateau = `max(0%, calc(100% - 100% / ${INTENSITY} / ${tone}))`
    return `linear-gradient(to top, ${sole} 0%, ${sole} ${plateau}, transparent 100%)`
}

export function TileHalo({ side, width, height, depth, offsetTop = 0, color, phase, reducedMotion }: { side: HaloSide; width: number; height: number; depth: number; offsetTop?: number; color: string; phase: number; reducedMotion?: boolean }) {
    const breathe = reducedMotion
        ? { opacity: 0.9 }
        : { animation: `iso-tile-halo ${PERIOD} ease-in-out infinite`, animationDelay: `calc(${PERIOD} * ${-phase.toFixed(3)})` }

    return (
        <div
            className={side === 'front' ? 'absolute inset-0 pointer-events-none iso-halo-front' : 'absolute inset-0 pointer-events-none'}
            style={offsetTop ? { top: offsetTop } : undefined}
        >
            <div className="absolute inset-0" style={breathe}>
                {WALLS.filter(wall => wall.side === side).map(wall => (
                    <div
                        key={wall.key}
                        className="absolute"
                        style={{
                            left: width * wall.x,
                            top: `calc(${height * wall.y}px - ${height}px * ${HEIGHT})`,
                            width: width / 2,
                            height: `calc(${height}px * ${HEIGHT} + ${depth}px)`,
                            transform: `skewY(${wall.skew}deg)`,
                            transformOrigin: 'top left',
                            background: body(color, wall.tone),
                        }}
                    />
                ))}
            </div>
        </div>
    )
}
