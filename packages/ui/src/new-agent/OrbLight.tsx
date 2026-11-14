import { cn } from '../cn'

const BODY = '104, 80, 252'
const RIM = '192, 124, 255'
const EDGE = '226, 216, 255'

const DITHER = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`

export function fall(spread: number, at = '50% 0%') {
    const edge = `min(${spread}deg, calc(88deg - var(--light-tilt, 0deg)))`
    return `conic-gradient(from calc(180deg - var(--light-angle, 0deg)) at ${at}, #000 0deg, #000 calc(${edge} * 0.6), transparent ${edge}, transparent calc(360deg - ${edge}), #000 calc(360deg - ${edge} * 0.6), #000 360deg)`
}

function reach(width: number, height: number) {
    return `radial-gradient(${width}px ${height}px at 50% 0%, #000, rgba(0, 0, 0, 0.66) 30%, rgba(0, 0, 0, 0.28) 60%, rgba(0, 0, 0, 0.08) 82%, transparent)`
}

type Sheet = { color: string; alpha: number; spread: number; width: number; height: number }

function LightSheet({ sheet, grain = false }: { sheet: Sheet; grain?: boolean }) {
    return (
        <div className="absolute inset-0" style={{ maskImage: fall(sheet.spread) }}>
            <div className="absolute inset-0" style={{ maskImage: reach(sheet.width, sheet.height) }}>
                <div className="absolute inset-0" style={{ backgroundColor: `rgba(${sheet.color}, ${sheet.alpha})` }} />
                {grain && <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: DITHER }} />}
            </div>
        </div>
    )
}

export function OrbLight({ focused, top, className }: { focused: boolean; top: number; className?: string }) {
    return (
        <>
            <Fall focused={focused} top={top} tone="light" className={cn('mix-blend-multiply dark:hidden', className)} />
            <Fall focused={focused} top={top} tone="dark" className={cn('hidden mix-blend-screen dark:block', className)} />
        </>
    )
}

function Fall({ focused, top, tone, className }: { focused: boolean; top: number; tone: 'light' | 'dark'; className?: string }) {
    const k = tone === 'dark' ? 1 : 0.62
    const spill: Sheet = focused ? { color: BODY, alpha: 0.09 * k, spread: 72, width: 620, height: 340 } : { color: BODY, alpha: 0.1 * k, spread: 84, width: 760, height: 330 }
    const core: Sheet = focused ? { color: BODY, alpha: 0.12 * k, spread: 30, width: 460, height: 360 } : { color: BODY, alpha: 0.09 * k, spread: 40, width: 460, height: 330 }
    const rim: Sheet = { color: RIM, alpha: 0.08 * k, spread: 60, width: 280, height: 170 }
    return (
        <div aria-hidden className={cn('pointer-events-none absolute left-1/2 h-[560px] w-[1280px]', className)} style={{ top, transform: 'translate(calc(-50% + var(--orb-x, 0px)), var(--orb-y, 0px))' }}>
            <LightSheet sheet={spill} grain={tone === 'dark'} />
            <LightSheet sheet={core} />
            <LightSheet sheet={rim} />
        </div>
    )
}

export function FieldLight({ focused }: { focused: boolean }) {
    return (
        <>
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: `radial-gradient(${focused ? '50% 110%' : '62% 120%'} at calc(50% + var(--light-dx, 0px)) 0%, rgba(${BODY}, ${focused ? 0.075 : 0.06}), transparent 80%)` }} />
            <span aria-hidden className="pointer-events-none absolute -top-px hidden h-px -translate-x-1/2 dark:block" style={{ left: 'calc(50% + var(--light-dx, 0px))', width: focused ? '50%' : '64%', background: `linear-gradient(90deg, transparent, rgba(${EDGE}, ${focused ? 0.26 : 0.2}), transparent)` }} />
            <span aria-hidden className="pointer-events-none absolute -top-px h-px -translate-x-1/2 dark:hidden" style={{ left: 'calc(50% + var(--light-dx, 0px))', width: focused ? '50%' : '64%', background: `linear-gradient(90deg, transparent, rgba(${BODY}, ${focused ? 0.34 : 0.26}), transparent)` }} />
        </>
    )
}
