'use client'

import { GlobeIcon } from '../icons'
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform, type Variants } from 'motion/react'
import { type CSSProperties, type PointerEvent, type ReactNode, useCallback, useEffect, useRef } from 'react'

import { cn } from '../cn'
import { BorderBeam } from '../BorderBeam'
import { TextShimmer } from '../TextShimmer'
import { Badge } from '../primitives/badge'
import { R_PATH } from '../logo'
import { SOCIAL_LINK_REL } from './expert-profile-parts'
import { useKitTranslations } from '../locale'

export type HoloExpertData = {
    name: string
    role: string
    location?: string
    description?: string
    photoUrl?: string
    initials: string
    badgeLabel: string
    socials: { x?: string; linkedin?: string; github?: string; website?: string }
}

function XIcon() {
    return (
        <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    )
}

function LinkedInIcon() {
    return (
        <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
        </svg>
    )
}

function GitHubIcon() {
    return (
        <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
    )
}

function SocialLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
    return (
        <a
            href={href}
            target="_blank"
            rel={SOCIAL_LINK_REL}
            aria-label={label}
            className="flex size-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/70 transition-colors hover:border-brand/50 hover:text-white hover:shadow-[0_0_12px_-2px_rgba(183,168,255,0.6)]"
        >
            {children}
        </a>
    )
}

function DataLabel({ children }: { children: ReactNode }) {
    return <span className="w-16 shrink-0 font-mono text-[11px] tracking-widest text-white/35 uppercase">{children}</span>
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value))
}

const ITEM_EASE = [0.16, 1, 0.3, 1] as const

const INTRO = {
    stagger: 0.2,
    delay: 0.8,
    item: {
        hidden: { opacity: 0, y: 8, filter: 'blur(5px)' },
        show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: ITEM_EASE } },
    } satisfies Variants,
}

const SCAN_LINE =
    'rounded-full bg-[linear-gradient(to_right,transparent,rgba(219,213,255,0.45)_25%,rgba(181,170,255,0.45)_50%,rgba(219,213,255,0.45)_75%,transparent)]'

const SCANLINES = [
    {
        delay: 0.3,
        duration: 3.8,
        blur: 'blur-[3px]',
        lines: [
            { h: 'h-1.5', w: 'w-[82%]', o: 0.14, gap: 'mt-3', x: '-translate-x-6' },
            { h: 'h-6', w: 'w-full', o: 0.28, gap: 'mt-2', x: '' },
            { h: 'h-1', w: 'w-[64%]', o: 0.1, gap: 'mt-1.5', x: 'translate-x-8' },
            { h: 'h-3', w: 'w-[92%]', o: 0.2, gap: 'mt-4', x: 'translate-x-2' },
            { h: 'h-0.5', w: 'w-[48%]', o: 0.08, gap: 'mt-2', x: '-translate-x-10' },
        ],
    },
    {
        delay: 0.45,
        duration: 4.6,
        blur: 'blur-[5px]',
        lines: [
            { h: 'h-1', w: 'w-[70%]', o: 0.1, gap: '', x: 'translate-x-4' },
            { h: 'h-4', w: 'w-[96%]', o: 0.22, gap: 'mt-5', x: '-translate-x-3' },
            { h: 'h-2', w: 'w-[80%]', o: 0.14, gap: 'mt-2', x: 'translate-x-10' },
            { h: 'h-8', w: 'w-full', o: 0.25, gap: 'mt-3', x: '' },
        ],
    },
    {
        delay: 0.6,
        duration: 3.2,
        blur: 'blur-[6px]',
        lines: [
            { h: 'h-2', w: 'w-[88%]', o: 0.14, gap: '', x: '-translate-x-6' },
            { h: 'h-1', w: 'w-[56%]', o: 0.09, gap: 'mt-2.5', x: 'translate-x-6' },
            { h: 'h-5', w: 'w-full', o: 0.2, gap: 'mt-4', x: '' },
            { h: 'h-1.5', w: 'w-[74%]', o: 0.11, gap: 'mt-2', x: 'translate-x-3' },
        ],
    },
] as const

export function HoloExpertCard({ data, className, revealed = true }: { data: HoloExpertData; className?: string; revealed?: boolean }) {
    const t = useKitTranslations()
    const reduceMotion = useReducedMotion()
    const ref = useRef<HTMLDivElement>(null)

    const pointerX = useMotionValue(0.5)
    const pointerY = useMotionValue(0.5)
    const active = useMotionValue(0)

    const spring = { stiffness: 150, damping: 20, mass: 0.4 }
    const smoothX = useSpring(pointerX, spring)
    const smoothY = useSpring(pointerY, spring)
    const smoothActive = useSpring(active, { stiffness: 120, damping: 22 })

    const maxTilt = reduceMotion ? 0 : 16
    const rotateX = useTransform<number, number>([smoothY, smoothActive], ([v, a]) => (0.5 - v) * 2 * maxTilt * a)
    const rotateY = useTransform<number, number>([smoothX, smoothActive], ([v, a]) => (v - 0.5) * 2 * maxTilt * a)
    const lift = useTransform(smoothActive, v => v * 22)
    const scale = useTransform(smoothActive, v => (reduceMotion ? 1 : 1 + v * 0.05))
    const transform = useMotionTemplate`perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(${lift}px) scale(${scale})`

    const shadowX = useTransform<number, number>([smoothX, smoothActive], ([v, a]) => (0.5 - v) * 40 * a)
    const shadowY = useTransform<number, number>([smoothY, smoothActive], ([v, a]) => (v - 0.5) * 40 * a + 18)
    const shadowBlur = useTransform(smoothActive, v => 40 + v * 30)
    const boxShadow = useMotionTemplate`${shadowX}px ${shadowY}px ${shadowBlur}px -18px rgba(0,0,0,0.85), 0 0 55px -12px rgba(183,168,255,${useTransform(smoothActive, v => 0.35 + v * 0.35)})`

    const mx = useMotionTemplate`${useTransform(smoothX, v => v * 100)}%`
    const my = useMotionTemplate`${useTransform(smoothY, v => v * 100)}%`

    const fromCenter = useTransform<number, number>([smoothX, smoothY], ([x, y]) => clamp01(Math.hypot(x - 0.5, y - 0.5) * 2))
    const bgx = useMotionTemplate`${useTransform(smoothX, v => 40 + v * 20)}%`
    const bgy = useMotionTemplate`${useTransform(smoothY, v => 40 + v * 20)}%`
    const sparkleX = useMotionTemplate`${useTransform(smoothX, v => 60 - v * 40)}%`
    const sparkleY = useMotionTemplate`${useTransform(smoothY, v => 60 - v * 40)}%`

    const gridX = useTransform<number, number>([smoothX, smoothActive], ([v, a]) => (reduceMotion ? 0 : (v - 0.5) * -26 * a))
    const gridY = useTransform<number, number>([smoothY, smoothActive], ([v, a]) => (reduceMotion ? 0 : (v - 0.5) * -26 * a))

    function setFromClient(clientX: number, clientY: number) {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        pointerX.set(clamp01((clientX - rect.left) / rect.width))
        pointerY.set(clamp01((clientY - rect.top) / rect.height))
        active.set(1)
    }

    function handleMove(event: PointerEvent<HTMLDivElement>) {
        setFromClient(event.clientX, event.clientY)
    }

    function handleLeave() {
        active.set(0)
    }

    const handleOrientation = useCallback(
        (event: DeviceOrientationEvent) => {
            const gamma = event.gamma ?? 0
            const beta = event.beta ?? 0
            pointerX.set(clamp01(0.5 + gamma / 45))
            pointerY.set(clamp01(0.5 + (beta - 40) / 45))
            active.set(1)
        },
        [pointerX, pointerY, active],
    )

    const enableGyroscope = useCallback(() => {
        if (reduceMotion || typeof window === 'undefined') return
        const Sensor = window.DeviceOrientationEvent as
            | (typeof window.DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> })
            | undefined
        if (!Sensor) return

        const attach = () => window.addEventListener('deviceorientation', handleOrientation)
        if (typeof Sensor.requestPermission === 'function') {
            Sensor.requestPermission()
                .then(state => {
                    if (state === 'granted') attach()
                })
                .catch(() => {})
        } else {
            attach()
        }
    }, [reduceMotion, handleOrientation])

    useEffect(() => {
        return () => {
            if (typeof window !== 'undefined') window.removeEventListener('deviceorientation', handleOrientation)
        }
    }, [handleOrientation])

    const name = data.name.trim() || t('experts.card.namePlaceholder')
    const role = data.role.trim() || t('experts.card.rolePlaceholder')
    const location = data.location?.trim() ?? ''
    const description = data.description?.trim() ?? ''
    const photo = data.photoUrl?.trim() ?? ''
    const x = data.socials.x?.trim() ?? ''
    const linkedin = data.socials.linkedin?.trim() ?? ''
    const github = data.socials.github?.trim() ?? ''
    const website = data.socials.website?.trim() ?? ''
    const hasSocials = Boolean(x || linkedin || github || website)

    const animating = !reduceMotion
    const item = animating ? { variants: INTRO.item } : {}
    const containerProps = animating
        ? {
              variants: { hidden: {}, show: { transition: { staggerChildren: INTRO.stagger, delayChildren: INTRO.delay } } } satisfies Variants,
              initial: 'hidden' as const,
              animate: revealed ? 'show' : 'hidden',
          }
        : {}

    return (
        <motion.div
            ref={ref}
            onPointerMove={handleMove}
            onPointerLeave={handleLeave}
            onPointerDown={enableGyroscope}
            style={
                {
                    transform,
                    boxShadow,
                    '--mx': mx,
                    '--my': my,
                    '--holo-opacity': smoothActive,
                    '--holo-from-center': fromCenter,
                    '--holo-bgx': bgx,
                    '--holo-bgy': bgy,
                    '--holo-sparkle-x': sparkleX,
                    '--holo-sparkle-y': sparkleY,
                } as unknown as CSSProperties
            }
            // `dark` en dur : les effets holographiques reposent sur des blend modes (color-dodge,
            // screen) qui n'ont pas d'équivalent sur fond clair. La carte reste sombre dans les deux thèmes.
            className={cn(
                'dark holo-card group relative w-full max-w-[360px] overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(130%_80%_at_50%_0%,#2c1d54,#0b0713)] will-change-transform',
                className,
            )}
        >
            <motion.div aria-hidden style={{ x: gridX, y: gridY }} className="pointer-events-none absolute -inset-8 will-change-transform">
                <div className="holo-matrix absolute inset-0" />
                <div className="holo-matrix-holo absolute inset-0 motion-reduce:hidden" />
            </motion.div>
            <div className="holo-layer holo-foil" aria-hidden />
            <div className="holo-layer holo-cross-field motion-reduce:hidden" aria-hidden />
            <div className="holo-scrim absolute inset-0 z-[7] rounded-2xl" aria-hidden />
            <div className="holo-halo pointer-events-none absolute inset-0 z-[8] rounded-2xl" aria-hidden />
            <motion.div
                aria-hidden
                style={{ x: gridX, y: gridY }}
                className="pointer-events-none absolute -inset-8 z-[6] will-change-transform motion-reduce:hidden"
            >
                <div className="holo-matrix-holo holo-matrix-holo--over absolute inset-0" />
            </motion.div>

            <motion.div className="relative z-10 flex flex-col" {...containerProps}>
                <motion.div className="flex items-center justify-between px-6 pt-8" {...item}>
                    <TextShimmer
                        as="span"
                        duration={3}
                        className="font-mono text-[11px] font-semibold tracking-[0.3em] uppercase [--shimmer-base:var(--color-brand)] [--shimmer-highlight:#dbd5ff]"
                    >
                        Rerun Experts
                    </TextShimmer>
                    <span className="font-mono text-[10px] tracking-widest text-white/25">◆ ◇ ◆</span>
                </motion.div>

                <motion.div className="relative mt-3 h-52" {...item}>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative size-24 rounded-full shadow-[0_0_34px_-6px_rgba(183,168,255,0.7)]">
                            {photo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={photo} alt={name} draggable={false} className="absolute inset-0 size-full rounded-full object-cover" />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/5 font-heading text-3xl font-semibold text-white/75">
                                    {data.initials}
                                </div>
                            )}
                            <BorderBeam pattern="ring" tone="brand" glow animated width={1} duration={6} radius="9999px" className="z-10" />
                            <BorderBeam pattern="arcs" tone="white" glow animated width={1} duration={4} radius="9999px" className="z-10" />
                        </div>
                    </div>
                </motion.div>

                <div className="px-6 pt-6">
                    <motion.h2
                        className="bg-radial-[at_50%_-40%] from-white from-12% via-[#bab0ff] via-58% to-brand to-130% bg-clip-text font-heading text-3xl leading-none font-semibold tracking-tight text-transparent uppercase"
                        {...item}
                    >
                        {name}
                    </motion.h2>
                    <motion.p className="mt-2 font-mono text-[11px] tracking-[0.28em] text-white/45 uppercase" {...item}>
                        {role}
                    </motion.p>
                    {description && (
                        <motion.p className="mt-4 line-clamp-2 text-sm leading-relaxed text-white/55" {...item}>
                            {description}
                        </motion.p>
                    )}
                </div>

                <div className="mt-6 space-y-2.5 px-6">
                    {location && (
                        <motion.div className="flex items-center gap-3" {...item}>
                            <DataLabel>{t('experts.card.location')}</DataLabel>
                            <span className="font-mono text-[11px] text-white/25">&gt;</span>
                            <span className="min-w-0 truncate font-mono text-xs text-white/85">{location}</span>
                        </motion.div>
                    )}
                    <motion.div className="flex items-center gap-3" {...item}>
                        <DataLabel>{t('experts.card.status')}</DataLabel>
                        <span className="font-mono text-[11px] text-white/25">&gt;</span>
                        <Badge tone="brand" size="xs" className="relative overflow-hidden tracking-wider uppercase shadow-[0_0_16px_-3px_rgba(183,168,255,0.7)]">
                            <span className="relative z-[1]">{data.badgeLabel}</span>
                            <span aria-hidden className="holo-badge-halo pointer-events-none absolute inset-0 rounded-full" />
                        </Badge>
                    </motion.div>
                    {hasSocials && (
                        <motion.div className="flex items-center gap-3 pt-0.5" {...item}>
                            <DataLabel>{t('experts.card.links')}</DataLabel>
                            <span className="font-mono text-[11px] text-white/25">&gt;</span>
                            <div className="flex items-center gap-1.5">
                                {x && (
                                    <SocialLink href={x} label="X">
                                        <XIcon />
                                    </SocialLink>
                                )}
                                {linkedin && (
                                    <SocialLink href={linkedin} label="LinkedIn">
                                        <LinkedInIcon />
                                    </SocialLink>
                                )}
                                {github && (
                                    <SocialLink href={github} label="GitHub">
                                        <GitHubIcon />
                                    </SocialLink>
                                )}
                                {website && (
                                    <SocialLink href={website} label={t('experts.wizard.website')}>
                                        <GlobeIcon className="size-3.5" />
                                    </SocialLink>
                                )}
                            </div>
                        </motion.div>
                    )}
                </div>

                <div className="mx-6 mt-6 border-t border-dashed border-white/10" />

                <motion.div className="flex items-center justify-between px-6 py-5 font-mono text-[10px] tracking-widest text-white/30 uppercase" {...item}>
                    <span>Rerun.build</span>
                    <span className="relative inline-flex size-4 items-center justify-center text-white/70">
                        <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden className="size-full drop-shadow-[0_0_6px_rgba(183,168,255,0.85)]">
                            <path fillRule="evenodd" d={R_PATH} />
                        </svg>
                    </span>
                </motion.div>
            </motion.div>

            <div className="holo-layer holo-glare motion-reduce:hidden" aria-hidden />

            {!reduceMotion &&
                revealed &&
                SCANLINES.map((scan, index) => (
                    <motion.div
                        key={index}
                        aria-hidden
                        className={cn(
                            'pointer-events-none absolute left-1/2 z-30 flex w-[180%] -translate-x-1/2 -rotate-[18deg] flex-col items-center mix-blend-screen',
                            scan.blur,
                        )}
                        initial={{ top: '-50%', opacity: 0 }}
                        animate={{ top: ['-50%', '150%'], opacity: [0, 1, 1, 0] }}
                        transition={{
                            top: { duration: scan.duration, delay: scan.delay, ease: [0.25, 0.1, 0.25, 1] },
                            opacity: { duration: scan.duration, delay: scan.delay, ease: 'easeInOut', times: [0, 0.22, 0.78, 1] },
                        }}
                    >
                        {scan.lines.map((line, lineIndex) => (
                            <div key={lineIndex} className={cn(SCAN_LINE, line.h, line.w, line.gap, line.x)} style={{ opacity: line.o }} />
                        ))}
                    </motion.div>
                ))}

            <BorderBeam pattern="arcs" tone="brand" glow animated width={1} duration={7} className="z-20" />
        </motion.div>
    )
}
