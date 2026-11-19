'use client'

import { Orb } from '@moldwright/ui/foreman'
import { type AgentSuggestion, BrowseTemplates, Composer, type ConnectorCatalog, fall, Floor, type FloorLight, ForYouCards, SUGGESTION_CARDS, type JobReader, type JobReading, type NewAgentDraft, type NewAgentRequest, OrbLight, useFollow, useNewAgentDraft } from '@moldwright/ui/new-agent'
import { useTranslations } from 'next-intl'
import { type ReactNode, type RefObject, useRef } from 'react'

const ORB_SIZE = 56

export type NewAgentStill = { draft: NewAgentDraft; reading?: JobReading; aim?: string; cursorRef?: RefObject<HTMLElement | null>; drawnCaret?: boolean; overlay?: ReactNode }

const FADE = 'radial-gradient(ellipse 820px 520px at 50% calc(50% + 240px), #000 0%, rgba(0,0,0,0.6) 50%, transparent 100%)'

function floorLight(focused: boolean): FloorLight {
    const source = 'calc(50% + var(--orb-x, 0px)) calc(50% + var(--orb-y, 0px))'
    return {
        masks: [fall(focused ? 60 : 80, source), `radial-gradient(760px 440px at ${source}, #000, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.18) 70%, transparent)`],
        light: 'rgb(104 80 252 / 0.2)',
        dark: 'rgb(200 190 255 / 0.18)',
    }
}

export function NewAgentForm({ suggestions, suggestionsHeading, catalog, read, onCreate, onBrowseTemplates, still }: { suggestions: AgentSuggestion[]; suggestionsHeading?: string; catalog: ConnectorCatalog | null; read: JobReader; onCreate: (agent: NewAgentRequest) => void; onBrowseTemplates: () => void; still?: NewAgentStill }) {
    const t = useTranslations('dialogs.newAgent')
    const rootRef = useRef<HTMLDivElement>(null)
    const anchorRef = useRef<HTMLSpanElement>(null)
    const gaze = useFollow({ rootRef, anchorRef, cursorRef: still?.cursorRef, aim: still?.aim })
    const { name, described, pending, editing, composer, forYou } = useNewAgentDraft({ suggestions, shown: SUGGESTION_CARDS, read, onCreate, seed: still })

    return (
        <div ref={rootRef} className="relative isolate flex min-h-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto bg-background px-4 sm:h-full sm:overflow-hidden sm:px-10">
            <div className="relative flex w-full max-w-[700px] flex-col items-center pt-6 pb-8 sm:my-auto sm:pt-0 sm:pb-12">
                <div className="hidden sm:contents">
                    <Floor fade={FADE} lights={[floorLight(described)]} style={{ top: ORB_SIZE / 2 }} />
                    <OrbLight focused={described} top={ORB_SIZE / 2} className="z-10" />
                </div>
                <div className="relative z-20">
                    <span ref={anchorRef} aria-hidden className="absolute top-1/2 left-1/2" />
                    <div style={{ transform: 'translate(var(--orb-x, 0px), var(--orb-y, 0px))' }}>
                        <Orb state={pending ? 'thinking' : 'listening'} size={ORB_SIZE} gaze={gaze} />
                    </div>
                </div>
                <h2 className="mt-5 text-center font-heading text-2xl font-medium tracking-tight">{name ? t('headingNamed', { name }) : t('heading')}</h2>
                <Composer {...composer} catalog={catalog} drawnCaret={Boolean(still?.drawnCaret) && !editing} className="mt-6 w-full" />
                <ForYouCards {...forYou} heading={suggestionsHeading} catalog={catalog} className="mt-9 w-full" />
                <BrowseTemplates onBrowse={onBrowseTemplates} className="mt-7 w-full" />
            </div>
            {still?.overlay}
        </div>
    )
}
