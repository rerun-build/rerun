'use client'

import { agentAddress, modelLabel } from '@rerun/contracts'
import { formatDate, formatNumber, shortRelativeTime } from '@rerun/i18n/format'
import { MODEL_ICONS, type ModelLogoSlug } from '@rerun/ui/beams'
import { CoworkerFace } from '@rerun/ui/inbox'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { createContext, useContext, useMemo, useState, type ComponentType, type ReactNode } from 'react'

import type { UsageCoworker, UsagePerson } from '@/app/api/_services/usage.service'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { AlertTriangleIcon, BellIcon, CalendarClockIcon, KeyIcon, MonitorIcon, UsersIcon, WebhookIcon } from '@/lib/icons'
import { initialsOf } from '@/lib/naming/initials'
import { cn } from '@/lib/utils'

import { NOT_RECORDED, UNKNOWN_MODEL, readableModelId, splitModelKey, type Granularity, type UsageRow } from './usage-model'

export function useUsageFormat() {
    const locale = useLocale()
    const t = useTranslations('usage')
    return useMemo(() => {
        const money = (dollars: number) => formatNumber(dollars, locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
        return {
            usd: (micros: number) => {
                if (micros === 0) return money(0)
                if (micros < 10_000) return t('lessThan', { amount: money(0.01) })
                return money(micros / 1_000_000)
            },
            tokens: (n: number) => formatNumber(n, locale, { notation: 'compact', maximumFractionDigits: 1 }),
            count: (n: number) => formatNumber(n, locale),
            ago: (ms: number, now: number) => shortRelativeTime(new Date(ms).toISOString(), locale, new Date(now)),
            bucket: (start: number, granularity: Granularity) => formatDate(start, locale, granularity === 'hour' ? { hour: 'numeric' } : { month: 'short', day: 'numeric' }),
            day: (ms: number) => formatDate(ms, locale, { month: 'short', day: 'numeric' }),
        }
    }, [locale, t])
}

export type UsageFormat = ReturnType<typeof useUsageFormat>

// The house logo of a model, read from its id: the same model looks the same whoever serves it.
const MODEL_LOGO_PREFIXES: [RegExp, ModelLogoSlug][] = [
    [/claude|anthropic/, 'claude'],
    [/(^|\/)(gpt|o\d|chatgpt|codex)|openai/, 'openai'],
    [/gemini|gemma|google/, 'googlegemini'],
    [/grok|x-ai|xai/, 'grok'],
    [/llama|meta/, 'meta'],
    [/deepseek/, 'deepseek'],
    [/mistral|codestral|magistral/, 'mistralai'],
    [/qwen/, 'qwen'],
    [/kimi|moonshot/, 'moonshotai'],
    [/glm|zhipu|z-ai/, 'zhipu'],
    [/minimax/, 'minimax'],
    [/cohere|command/, 'cohere'],
    [/nvidia|nemotron/, 'nvidia'],
    [/perplexity|sonar/, 'perplexity'],
]

export function modelLogoSlug(model: string): ModelLogoSlug | null {
    const id = model.toLowerCase()
    return MODEL_LOGO_PREFIXES.find(([pattern]) => pattern.test(id))?.[1] ?? null
}

export function ModelLogo({ model, provider, small }: { model: string; provider?: string | null; small?: boolean }) {
    const slug = modelLogoSlug(model)
    const Glyph = slug ? MODEL_ICONS[slug] : null
    return (
        <span className={cn('flex shrink-0 items-center justify-center bg-muted ring-1 ring-border', small ? 'size-5 rounded-md' : 'size-7 rounded-lg')}>
            {Glyph ? <Glyph className={small ? 'size-3' : 'size-3.5'} /> : <ProviderIcon provider={provider ?? 'custom'} className={small ? 'size-3' : 'size-3.5'} />}
        </span>
    )
}

export function PersonAvatar({ name, photo, small }: { name: string; photo?: string | null; small?: boolean }) {
    const size = small ? 'size-5 text-[9px]' : 'size-7 text-[11px]'
    const [broken, setBroken] = useState(false)
    // eslint-disable-next-line @next/next/no-img-element -- a profile photo from any provider of the sign-in, too small to resize
    if (photo && !broken) return <img src={photo} alt="" loading="lazy" onError={() => setBroken(true)} className={cn('shrink-0 rounded-full object-cover', size)} />
    return <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-brand/15 font-medium text-brand', size)}>{initialsOf(name.trim()) || '?'}</span>
}

export function GlyphTile({ icon: Glyph, warn, small }: { icon: ComponentType<{ className?: string }>; warn?: boolean; small?: boolean }) {
    return (
        <span className={cn('flex shrink-0 items-center justify-center rounded-full', small ? 'size-5' : 'size-7', warn ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground')}>
            <Glyph className={small ? 'size-3' : 'size-3.5'} />
        </span>
    )
}

const STARTER_GLYPH: Record<string, { icon: ComponentType<{ className?: string }>; warn?: boolean }> = {
    coworker: { icon: UsersIcon },
    schedule: { icon: CalendarClockIcon },
    webhook: { icon: WebhookIcon },
    checkin: { icon: BellIcon },
    job: { icon: MonitorIcon },
    api: { icon: KeyIcon },
    [NOT_RECORDED]: { icon: AlertTriangleIcon, warn: true },
}

type Directory = {
    coworkers: Map<string, UsageCoworker>
    people: Map<string, UsagePerson>
}

const DirectoryContext = createContext<Directory>({ coworkers: new Map(), people: new Map() })

export function UsageDirectoryProvider({ coworkers, people, children }: { coworkers: UsageCoworker[]; people: UsagePerson[]; children: ReactNode }) {
    const value = useMemo(() => ({ coworkers: new Map(coworkers.map(c => [c.id, c])), people: new Map(people.map(p => [p.id, p])) }), [coworkers, people])
    return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>
}

export type Labelled = { label: string; sub?: string; leading: ReactNode; leadingSmall: ReactNode }

// The names, pictures and logos of the rows: a coworker, who started a run, a model.
export function useUsageLabels() {
    const { coworkers, people } = useContext(DirectoryContext)
    const t = useTranslations('usage')

    return useMemo(() => {
        const coworkerName = (id: string) => coworkers.get(id)?.name ?? t('coworker.gone')
        // The Chief of Staff is drawn as its orb, every other coworker as its buddy.
        const coworkerFace = (id: string, size: number) => {
            const known = coworkers.get(id)
            return <CoworkerFace agentId={known ? agentAddress(known) : id} size={size} />
        }
        const coworker = (id: string): Labelled => ({ label: coworkerName(id), leading: coworkerFace(id, 28), leadingSmall: coworkerFace(id, 20) })

        const personName = (id: string, fallback: string | null) => people.get(id)?.name ?? fallback ?? t('starter.formerMember')
        // A row of "Started by" groups every calling coworker, every schedule...; a run (`one`) names
        // the coworker that called it.
        const starter = (key: string, run?: Pick<UsageRow, 'starterId' | 'starterName'>, one = false): Labelled => {
            if (key.startsWith('person:')) {
                const id = key.slice('person:'.length)
                const name = personName(id, run?.starterName ?? null)
                const photo = people.get(id)?.avatarUrl
                return { label: name, sub: t('starter.member'), leading: <PersonAvatar name={name} photo={photo} />, leadingSmall: <PersonAvatar name={name} photo={photo} small /> }
            }
            if (one && key === 'coworker' && run?.starterId && coworkers.has(run.starterId)) return coworker(run.starterId)
            const glyph = STARTER_GLYPH[key] ?? STARTER_GLYPH[NOT_RECORDED]
            const kind = key in STARTER_GLYPH ? key : NOT_RECORDED
            return {
                label: one ? t(`starter.one.${kind}` as 'starter.one.schedule') : t(`starter.many.${kind}` as 'starter.many.schedule'),
                sub: t(`starter.sub.${kind}` as 'starter.sub.schedule'),
                leading: <GlyphTile icon={glyph.icon} warn={glyph.warn} />,
                leadingSmall: <GlyphTile icon={glyph.icon} warn={glyph.warn} small />,
            }
        }

        // A model is named by its key (`modelKeyOf`), which says whether it ran on a subscription.
        const modelName = (key: string) => {
            const { model, subscription } = splitModelKey(key)
            if (model === UNKNOWN_MODEL) return t('model.unknown')
            const label = modelLabel(model)
            const name = label === model ? readableModelId(model) : label
            return subscription ? t('model.subscription', { model: name }) : name
        }
        const model = (key: string, provider?: string | null): Labelled => {
            const id = splitModelKey(key).model
            return { label: modelName(key), leading: <ModelLogo model={id} provider={provider} />, leadingSmall: <ModelLogo model={id} provider={provider} small /> }
        }

        return { coworker, coworkerFace, coworkerName, starter, model, modelName, coworkerIds: [...coworkers.keys()] }
    }, [coworkers, people, t])
}

export type UsageLabels = ReturnType<typeof useUsageLabels>

export function CostValue({ micros, className }: { micros: number | null; className?: string }) {
    const t = useTranslations('usage')
    const format = useUsageFormat()
    if (micros === null)
        return (
            <span title={t('noPriceHint')} className={className}>
                <Badge tone="neutral" size="sm" glow={false}>
                    {t('noPrice')}
                </Badge>
            </span>
        )
    return <span className={cn('tabular-nums', className)}>{format.usd(micros)}</span>
}

export function LiveDot({ label }: { label: string }) {
    return (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
            </span>
            {label}
        </span>
    )
}
