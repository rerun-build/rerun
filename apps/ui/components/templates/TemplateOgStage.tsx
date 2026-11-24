'use client'

import type { TemplateAgent, TemplateConnector } from '@rerun/contracts'
import { TemplateBoardPreview } from '@rerun/ui/iso-grid'
import type { RefObject } from 'react'

import { RerunWordmark } from '@/components/brand/RerunWordmark'
import { OgCta } from '@/components/og/OgCta'
import { OG_HEIGHT, OG_WIDTH } from '@/lib/og/size'

function titleClass(title: string) {
    if (title.length > 46) return 'text-4xl'
    return title.length > 28 ? 'text-5xl' : 'text-[4rem]'
}

export type TemplateOgStageProps = {
    title: string
    tagline: string
    agents: TemplateAgent[]
    connectors: TemplateConnector[]
    innerRef?: RefObject<HTMLDivElement | null>
    rounded?: boolean
}

export function TemplateOgStage({ title, tagline, agents, connectors, innerRef, rounded = true }: TemplateOgStageProps) {
    return (
        <div
            ref={innerRef}
            className={`dark relative overflow-hidden bg-[#0a0a0a] text-white ${rounded ? 'rounded-2xl border border-border' : ''}`}
            style={{ width: OG_WIDTH, height: OG_HEIGHT }}
        >
            <div className="absolute inset-y-0 end-0 w-[640px]">
                <TemplateBoardPreview agents={agents} connectors={connectors} className="size-full" />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,#0a0a0a_22%,rgba(10,10,10,0.72)_42%,transparent_68%)]" />

            <div className="absolute start-16 top-14 z-20">
                <RerunWordmark />
            </div>

            <div className="absolute inset-y-0 start-16 z-20 flex max-w-[500px] flex-col items-start justify-center gap-8">
                <div className="flex flex-col gap-5">
                    <h2 className={`-mb-[0.14em] bg-radial-[at_35%_30%] from-white from-15% via-[#b4b4be] via-55% to-[#6f6f7d] to-95% bg-clip-text pb-[0.14em] font-semibold leading-[1.05] tracking-tight text-transparent ${titleClass(title)}`}>
                        {title}
                    </h2>
                    {tagline ? <p className="line-clamp-3 text-2xl leading-snug text-muted-foreground">{tagline}</p> : null}
                </div>
                <OgCta label="Use this template" />
            </div>
        </div>
    )
}
