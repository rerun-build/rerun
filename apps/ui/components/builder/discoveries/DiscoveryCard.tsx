'use client'

import { formatNumber } from '@rerun/i18n/format'
import { BorderBeam } from '@rerun/ui'
import { animate, motion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import { Icon } from '@/components/ui/icon'
import type { CompanyFinding, DiscoverySource } from '@/lib/company/explore/findings'
import {
    BrainIcon,
    Building2,
    GlobeIcon,
    HandshakeIcon,
    Mail,
    Megaphone,
    Package,
    Palette,
    StarIcon,
    TargetIcon,
    UserRoundIcon,
    UsersIcon,
    Wrench,
    type LucideIcon,
} from '@/lib/icons'
import { cn } from '@/lib/utils'

// How long a card that deserves it keeps its beam after landing: long enough to be seen arriving,
// short enough that a board full of cards is not a board full of moving outlines.
const ARRIVAL_BEAM_MS = 4000

const BEAMED_KINDS = new Set<CompanyFinding['kind']>(['identity', 'brain'])

export const DISCOVERY_CARD_CLASS = 'relative w-full rounded-xl border border-border bg-card p-3 shadow-lg shadow-black/15'

type DescribedSourceKey = 'website' | 'domain' | 'registry' | 'web'

const SOURCE_LABEL: Record<DiscoverySource, { brand: string } | { key: DescribedSourceKey }> = {
    profile: { key: 'website' },
    stack: { key: 'website' },
    site: { key: 'website' },
    catalog: { key: 'website' },
    dns: { key: 'domain' },
    registry: { key: 'registry' },
    search: { key: 'web' },
    linkedinPerson: { brand: 'LinkedIn' },
    linkedinCompany: { brand: 'LinkedIn' },
    googleBusiness: { brand: 'Google' },
    synthesis: { brand: 'Rerun' },
}

export function useDiscoverySourceLabel() {
    const t = useTranslations('builder.discoveries.sources')
    return (source: DiscoverySource) => {
        const label = SOURCE_LABEL[source]
        return 'brand' in label ? label.brand : t(label.key)
    }
}

export function DiscoveryCardShell({ icon, label, source, beam, children }: { icon: LucideIcon; label: string; source: DiscoverySource; beam?: boolean; children: ReactNode }) {
    const sourceLabel = useDiscoverySourceLabel()
    return (
        <div className={DISCOVERY_CARD_CLASS}>
            {beam && <BorderBeam animated pattern="arcs" tone="brand" glow width={1} outset={1} />}
            <div className="mb-2 flex items-center gap-2">
                <Icon icon={icon} size="xs" />
                <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/70">{sourceLabel(source)}</span>
            </div>
            {children}
        </div>
    )
}

function useArrivalBeam(enabled: boolean): boolean {
    const [lit, setLit] = useState(enabled)
    useEffect(() => {
        if (!enabled) return
        const timer = setTimeout(() => setLit(false), ARRIVAL_BEAM_MS)
        return () => clearTimeout(timer)
    }, [enabled])
    return enabled && lit
}

function formatCount(value: number, decimals: number, locale: string): string {
    return formatNumber(value, locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function CountUp({ value, decimals = 0, still }: { value: number; decimals?: number; still?: boolean }) {
    const locale = useLocale()
    const ref = useRef<HTMLSpanElement>(null)
    useEffect(() => {
        const node = ref.current
        if (!node || still) return
        const controls = animate(0, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: latest => (node.textContent = formatCount(latest, decimals, locale)) })
        return () => controls.stop()
    }, [value, decimals, still, locale])
    return (
        <span ref={ref} className="tabular-nums">
            {formatCount(value, decimals, locale)}
        </span>
    )
}

const STAR_PATH = 'M9 1.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2L9 13.4l-4.6 2.5.9-5.2L1.5 7l5.2-.8z'

function StarRow({ className }: { className: string }) {
    return (
        <div className={cn('flex w-max gap-0.5', className)}>
            {Array.from({ length: 5 }, (_, index) => (
                <svg key={index} viewBox="0 0 18 18" className="size-3.5 shrink-0" aria-hidden>
                    <path d={STAR_PATH} fill="currentColor" />
                </svg>
            ))}
        </div>
    )
}

function Stars({ rating, still }: { rating: number; still?: boolean }) {
    const filled = `${(rating / 5) * 100}%`
    return (
        <div className="relative w-fit">
            <StarRow className="text-muted-foreground/25" />
            <motion.div className="absolute inset-y-0 left-0 overflow-hidden" initial={{ width: still ? filled : 0 }} animate={{ width: filled }} transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}>
                <StarRow className="text-yellow-400" />
            </motion.div>
        </div>
    )
}

function ItemList({ items }: { items: string[] }) {
    return (
        <p className="text-xs leading-relaxed">
            {items.map((item, index) => (
                <Fragment key={item}>
                    {index > 0 && <span className="text-muted-foreground/60"> · </span>}
                    <span className="whitespace-nowrap">{item}</span>
                </Fragment>
            ))}
        </p>
    )
}

function BrainEntityCounts({ products, competitors }: { products: number; competitors: number }) {
    const t = useTranslations('builder.discoveries.cards.brain')
    if (!products && !competitors) return null
    const line = products && competitors ? t('productsAndCompetitors', { products, competitors }) : products ? t('productsOnly', { products }) : t('competitorsOnly', { competitors })
    return <p className="text-xs text-muted-foreground">{line}</p>
}

function ToolRow({ name, iconUrl }: { name: string; iconUrl: string | null }) {
    return (
        <div className="flex items-center gap-1.5">
            {iconUrl ? <Icon src={iconUrl} size="xs" /> : <Icon icon={Wrench} size="xs" />}
            <span className="text-xs">{name}</span>
        </div>
    )
}

function Logo({ src, name }: { src: string | null; name: string }) {
    if (!src)
        return <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-heading text-base font-medium text-primary">{name.slice(0, 1).toUpperCase()}</div>
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party logo URLs and data URIs
    return <img src={src} alt="" className="size-10 shrink-0 rounded-lg bg-white object-contain p-1" />
}

export function DiscoveryCard({ finding, still }: { finding: CompanyFinding; still?: boolean }) {
    const t = useTranslations('builder.discoveries.cards')
    const beam = useArrivalBeam(!still && BEAMED_KINDS.has(finding.kind))
    const bold = (chunks: ReactNode) => <span className="font-medium">{chunks}</span>
    const { source } = finding

    switch (finding.kind) {
        case 'identity':
            return (
                <DiscoveryCardShell icon={GlobeIcon} label={t('identity.title')} source={source} beam={beam}>
                    <div className="flex items-center gap-3">
                        <Logo src={finding.logoUrl} name={finding.name} />
                        <div className="min-w-0">
                            <p className="truncate font-heading text-sm font-medium">{finding.name}</p>
                            <p className="line-clamp-2 text-xs text-muted-foreground">{finding.oneLiner ?? finding.domain}</p>
                        </div>
                    </div>
                </DiscoveryCardShell>
            )
        case 'audience':
            return (
                <DiscoveryCardShell icon={UsersIcon} label={t('audience.title')} source={source}>
                    <p className="text-xs leading-relaxed">{finding.text}</p>
                </DiscoveryCardShell>
            )
        case 'tools':
            return (
                <DiscoveryCardShell icon={Wrench} label={t('tools.title')} source={source}>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {finding.tools.map(tool => (
                            <ToolRow key={tool.name} name={tool.name} iconUrl={tool.iconUrl} />
                        ))}
                    </div>
                </DiscoveryCardShell>
            )
        case 'mail':
            return (
                <DiscoveryCardShell icon={Mail} label={t('mail.title')} source={source}>
                    <div className="flex items-center gap-2">
                        {finding.iconUrl && <Icon src={finding.iconUrl} size="sm" />}
                        <p className="text-xs">{t.rich('mail.runsOn', { provider: finding.provider, b: bold })}</p>
                    </div>
                </DiscoveryCardShell>
            )
        case 'social':
            return (
                <DiscoveryCardShell icon={Megaphone} label={t('social.title')} source={source}>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {finding.networks.map(network => (
                            <div key={network.name} className="flex items-center gap-1.5">
                                {network.iconUrl ? <Icon src={network.iconUrl} size="xs" /> : <Icon icon={Megaphone} size="xs" />}
                                <span className="text-xs">{network.name}</span>
                                {network.audience && <span className="text-[10px] text-muted-foreground">{network.audience}</span>}
                            </div>
                        ))}
                    </div>
                </DiscoveryCardShell>
            )
        case 'brand':
            return (
                <DiscoveryCardShell icon={Palette} label={t('brand.title')} source={source}>
                    <div className="flex items-center gap-1.5">
                        {finding.colors.map((color, index) => (
                            <motion.span
                                key={color}
                                className="size-6 rounded-full border border-border shadow-sm"
                                style={{ backgroundColor: color }}
                                initial={still ? false : { scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.15 + index * 0.08 }}
                            />
                        ))}
                        {finding.fonts.length > 0 && <span className="ml-1.5 truncate text-xs text-muted-foreground">{finding.fonts.join(', ')}</span>}
                    </div>
                </DiscoveryCardShell>
            )
        case 'registry':
            return (
                <DiscoveryCardShell icon={Building2} label={t('registry.title')} source={source}>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {finding.founded && <span>{t.rich('registry.since', { year: finding.founded, b: bold })}</span>}
                        {finding.headcount && <span>{t.rich('registry.people', { headcount: finding.headcount, b: bold })}</span>}
                        {finding.city && <span className="text-muted-foreground">{finding.city}</span>}
                    </div>
                </DiscoveryCardShell>
            )
        case 'person':
            return (
                <DiscoveryCardShell icon={UserRoundIcon} label={t('person.title', { firstName: finding.name.split(' ')[0] })} source={source}>
                    <div className="flex items-center gap-3">
                        {finding.photoUrl ? (
                            <div className="relative shrink-0">
                                {!still && (
                                    <motion.span
                                        className="absolute inset-0 rounded-full ring-2 ring-primary"
                                        initial={{ scale: 1, opacity: 0.8 }}
                                        animate={{ scale: 1.5, opacity: 0 }}
                                        transition={{ duration: 1.4, repeat: 2, ease: 'easeOut' }}
                                    />
                                )}
                                {/* eslint-disable-next-line @next/next/no-img-element -- LinkedIn photo URLs are third-party */}
                                <img src={finding.photoUrl} alt="" className="relative size-10 rounded-full object-cover" />
                            </div>
                        ) : (
                            <Icon icon={UserRoundIcon} size="md" />
                        )}
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{finding.name}</p>
                            {finding.headline && <p className="line-clamp-2 text-xs text-muted-foreground">{finding.headline}</p>}
                        </div>
                    </div>
                </DiscoveryCardShell>
            )
        case 'linkedin':
            return (
                <DiscoveryCardShell icon={UsersIcon} label={t('linkedin.title')} source={source}>
                    <div className="flex items-baseline gap-4">
                        {finding.followers !== null && (
                            <div>
                                <p className="font-heading text-xl font-medium">
                                    <CountUp value={finding.followers} still={still} />
                                </p>
                                <p className="text-[10px] text-muted-foreground">{t('linkedin.followers')}</p>
                            </div>
                        )}
                        {finding.employees !== null && (
                            <div>
                                <p className="font-heading text-xl font-medium">
                                    <CountUp value={finding.employees} still={still} />
                                </p>
                                <p className="text-[10px] text-muted-foreground">{t('linkedin.team')}</p>
                            </div>
                        )}
                    </div>
                </DiscoveryCardShell>
            )
        case 'reviews':
            return (
                <DiscoveryCardShell icon={StarIcon} label={t('reviews.title')} source={source}>
                    <div className="flex items-center gap-3">
                        <p className="font-heading text-2xl font-medium">
                            <CountUp value={finding.rating} decimals={1} still={still} />
                        </p>
                        <div className="flex flex-col gap-1">
                            <Stars rating={finding.rating} still={still} />
                            <p className="text-[10px] text-muted-foreground">
                                {t.rich('reviews.count', { count: finding.count, n: () => <CountUp value={finding.count} still={still} /> })}
                            </p>
                        </div>
                    </div>
                </DiscoveryCardShell>
            )
        case 'products':
            return (
                <DiscoveryCardShell icon={Package} label={t('products.title')} source={source}>
                    <ItemList items={finding.items} />
                </DiscoveryCardShell>
            )
        case 'competitors':
            return (
                <DiscoveryCardShell icon={TargetIcon} label={t('competitors.title')} source={source}>
                    <ItemList items={finding.items} />
                </DiscoveryCardShell>
            )
        case 'customers':
            return (
                <DiscoveryCardShell icon={HandshakeIcon} label={t('customers.title')} source={source}>
                    <ItemList items={finding.items} />
                </DiscoveryCardShell>
            )
        case 'brain':
            return (
                <DiscoveryCardShell icon={BrainIcon} label={t('brain.title')} source={source} beam={beam}>
                    <p className="text-sm font-medium">{t('brain.pages', { count: finding.pages })}</p>
                    {finding.topics?.length ? <ItemList items={finding.topics} /> : null}
                    <BrainEntityCounts products={finding.products ?? 0} competitors={finding.competitors ?? 0} />
                </DiscoveryCardShell>
            )
    }
}
