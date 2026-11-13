'use client'

import { BorderBeam } from '@rerun/ui'
import { MODEL_ICONS, type ModelLogoSlug } from '@rerun/ui/beams'
import { Icon } from '@rerun/ui/primitives'
import type { ReactNode, RefObject } from 'react'

import { RerunWordmark } from '@/components/brand/RerunWordmark'
import { KeyIcon, RobotIcon, ShipWheelIcon, UserCogIcon, Users, type LucideIcon } from '@/lib/icons'
import { OG_HEIGHT, OG_WIDTH } from '@/lib/og/size'

import { OgCta } from '@/components/og/OgCta'

const MODELS: { logo: ModelLogoSlug; tone?: string }[] = [{ logo: 'anthropic', tone: 'text-[#D97757] dark:text-[#D97757]' }, { logo: 'openai' }, { logo: 'googlegemini' }]

const TILTS = ['-rotate-6', 'rotate-3', '-rotate-3']

function ModelMarks() {
    return (
        <span className="flex items-center">
            {MODELS.map((model, index) => (
                <Icon key={model.logo} icon={MODEL_ICONS[model.logo]} size="sm" glyphClassName={`size-4 ${model.tone ?? ''}`} className={`relative bg-[#0a0a0a] ${TILTS[index]} ${index > 0 ? '-ml-1.5' : ''}`} style={{ zIndex: MODELS.length - index }} />
            ))}
        </span>
    )
}

// The Pro tier of the pricing page, line for line, minus the model credit.
const BENEFITS: { icon: LucideIcon; title: string; detail: string; extra?: ReactNode }[] = [
    { icon: RobotIcon, title: 'A team of coworkers', detail: 'Working for you, side by side' },
    { icon: Users, title: 'Unlimited seats', detail: 'No per-user fees' },
    { icon: UserCogIcon, title: 'Your whole team', detail: 'Manage your coworkers together' },
    { icon: ShipWheelIcon, title: 'Autopilot', detail: 'Put your business on it' },
    { icon: KeyIcon, title: 'Your own AI subscription', detail: 'Or your API key', extra: <ModelMarks /> },
]

const COLUMNS = [BENEFITS.filter((_, index) => index % 2 === 0), BENEFITS.filter((_, index) => index % 2 === 1)]
const COLUMN_OFFSETS = [-44, 44]

function Benefits() {
    return (
        <div className="pointer-events-none absolute inset-y-0 right-14 z-10 flex items-center gap-5">
            {COLUMNS.map((column, i) => (
                <div key={i} className="flex flex-col gap-5" style={{ transform: `translateY(${COLUMN_OFFSETS[i]}px)` }}>
                    {column.map(benefit => (
                        <div key={benefit.title} className="relative flex w-[270px] flex-col gap-4 rounded-2xl bg-white/[0.03] p-5">
                            <BorderBeam tone="neutral" animated={false} radius="1rem" />
                            <div className="flex items-center justify-between">
                                <Icon icon={benefit.icon} size="md" />
                                {benefit.extra}
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-xl leading-tight font-medium tracking-tight text-neutral-100">{benefit.title}</span>
                                <span className="text-base leading-tight text-neutral-400">{benefit.detail}</span>
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}

export function PricingOgStage({ innerRef, rounded = true }: { innerRef?: RefObject<HTMLDivElement | null>; rounded?: boolean }) {
    return (
        <div
            ref={innerRef}
            className={`dark relative overflow-hidden bg-[#0a0a0a] text-white ${rounded ? 'rounded-2xl border border-white/15' : ''}`}
            style={{ width: OG_WIDTH, height: OG_HEIGHT }}
        >
            <Benefits />

            <div className="absolute left-16 top-14 z-20">
                <RerunWordmark />
            </div>

            <div className="absolute inset-y-0 left-16 z-20 flex flex-col items-start justify-center gap-8">
                <h2 className="-mb-[0.14em] bg-radial-[at_35%_30%] from-white from-15% via-[#b4b4be] via-55% to-[#6f6f7d] to-95% bg-clip-text pb-[0.14em] text-[4.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-transparent">
                    One plan.
                    <br />
                    Everything
                    <br />
                    included.
                </h2>
                <OgCta label="Start your free trial" />
            </div>
        </div>
    )
}
