'use client'

import { CoworkerLookPicker } from '@/components/agent/CoworkerLookPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeftIcon, ArrowRightIcon, LayoutGridIcon } from '@/lib/icons'
import { randomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'
import type { CoworkerLook } from '@rerun/contracts'
import { Orb } from '@rerun/ui/foreman'
import { AgentBuddy, hashedBuddyLook } from '@rerun/ui/iso-grid'
import { useKitTranslations } from '@rerun/ui/locale'
import { AGENT_NAME_MAX, type AgentSuggestion, BrowseTemplates, type ChosenAgentName, Composer, type ConnectorCatalog, fall, Floor, type FloorLight, ForYouCards, SUGGESTION_CARDS, type JobReader, type JobReading, type NewAgentDraft, type NewAgentRequest, OrbLight, useFollow, useNewAgentDraft } from '@rerun/ui/new-agent'
import { useTranslations } from 'next-intl'
import { type ReactNode, type RefObject, useRef, useState } from 'react'

const ORB_SIZE = 56
const BUDDY_SIZE = 112

// What a capture needs and a user never does: a draft and its reading to open on, the element the
// pointer rests on, the cursor drawn in its place, and a caret drawn in the field. A capture opens
// on the job, with the Orb, as the dialog did before a coworker was named first.
export type NewAgentStill = { draft: NewAgentDraft; reading?: JobReading; aim?: string; cursorRef?: RefObject<HTMLElement | null>; drawnCaret?: boolean; overlay?: ReactNode }

// The floor shows across the room and fades before the dialog's edges, centred on the content.
const FADE = 'radial-gradient(ellipse 820px 520px at 50% calc(50% + 240px), #000 0%, rgba(0,0,0,0.6) 50%, transparent 100%)'

// The Orb's light falls on the floor too: the same cone from the same moving source, swung the same
// way, with a little brighter lines where it lands.
function floorLight(focused: boolean): FloorLight {
    const source = 'calc(50% + var(--orb-x, 0px)) calc(50% + var(--orb-y, 0px))'
    return {
        masks: [fall(focused ? 60 : 80, source), `radial-gradient(760px 440px at ${source}, #000, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.18) 70%, transparent)`],
        light: 'rgb(104 80 252 / 0.2)',
        dark: 'rgb(200 190 255 / 0.18)',
    }
}

type Stage = 'name' | 'look' | 'job'

// What was written about the job, kept while the user steps back to the look.
type JobSeed = { draft: NewAgentDraft; reading?: JobReading }

type NewAgentFormProps = { suggestions: AgentSuggestion[]; suggestionsHeading?: string; catalog: ConnectorCatalog | null; read: JobReader; onCreate: (agent: NewAgentRequest) => void; onBrowseTemplates: () => void; still?: NewAgentStill }

// The coworker is named first, then dressed, then it asks what it is for: by the time the job is
// described, it already wears the name and the look it was given.
//
// Nothing is created here: `onCreate` receives the agent as described, and whoever owns the dialog
// sends it to the board to be placed.
export function NewAgentForm({ still, onCreate, onBrowseTemplates, ...job }: NewAgentFormProps) {
    const t = useTranslations('dialogs.newAgent')
    const kit = useKitTranslations()
    // The id its look is hashed from until one is chosen. The look shown is always the one sent.
    const [draftId] = useState(randomUuid)
    const [stage, setStage] = useState<Stage>(still ? 'job' : 'name')
    const [name, setName] = useState('')
    const [look, setLook] = useState<CoworkerLook | null>(null)
    const [keptJob, setKeptJob] = useState<JobSeed>()
    const named = name.trim() !== ''
    const worn = look ?? hashedBuddyLook(draftId)

    if (stage === 'name') {
        const next = () => named && setStage('look')
        return (
            <StepFrame
                key="name"
                footer={
                    <>
                        <Button variant="ghost" size="sm" data-aim="templates" onClick={onBrowseTemplates}>
                            <LayoutGridIcon className="size-3.5" />
                            {kit('newAgent.browseTemplates')}
                        </Button>
                        <Button size="sm" disabled={!named} onClick={next}>
                            {t('continue')}
                            <ArrowRightIcon className="size-3.5" />
                        </Button>
                    </>
                }
            >
                <h2 className="text-center font-heading text-2xl font-medium tracking-tight">{t('nameHeading')}</h2>
                <AgentBuddy agentId={draftId} mood="asleep" size={96} />
                <Input
                    aria-label={t('nameLabel')}
                    autoFocus
                    value={name}
                    maxLength={AGENT_NAME_MAX}
                    onChange={event => setName(event.target.value)}
                    onKeyDown={event => event.key === 'Enter' && next()}
                    className="h-10 w-full text-base"
                />
            </StepFrame>
        )
    }

    if (stage === 'look') {
        return (
            <StepFrame
                key="look"
                wide
                footer={
                    <>
                        <BackButton onClick={() => setStage('name')} />
                        <Button size="sm" onClick={() => setStage('job')}>
                            {t('continue')}
                            <ArrowRightIcon className="size-3.5" />
                        </Button>
                    </>
                }
            >
                <h2 className="text-center font-heading text-2xl font-medium tracking-tight">{t('lookHeading', { name: name.trim() })}</h2>
                <CoworkerLookPicker agentId={draftId} look={look} onChange={setLook} previewSize={88} />
            </StepFrame>
        )
    }

    const chosenName: ChosenAgentName | undefined = named ? { value: name.trim(), onRename: setName } : undefined
    return (
        <JobStep
            {...job}
            still={still}
            chosenName={chosenName}
            presence={named ? <AgentBuddy agentId={draftId} look={worn} size={BUDDY_SIZE} alive /> : null}
            seed={keptJob}
            onBack={
                still
                    ? undefined
                    : kept => {
                          setKeptJob(kept)
                          setStage('look')
                      }
            }
            onBrowseTemplates={onBrowseTemplates}
            onCreate={agent => onCreate(named ? { ...agent, look: worn } : agent)}
        />
    )
}

function BackButton({ onClick }: { onClick: () => void }) {
    const t = useTranslations('dialogs.newAgent')
    return (
        <Button variant="ghost" size="sm" onClick={onClick}>
            <ArrowLeftIcon className="size-3.5" />
            {t('back')}
        </Button>
    )
}

// The steps share one frame: the question on top, the step under it, and a bar at the bottom that
// stays in reach while the step scrolls on a small screen.
function StepFooter({ children }: { children: ReactNode }) {
    return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-4 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">{children}</div>
}

function StepFrame({ wide = false, footer, children }: { wide?: boolean; footer: ReactNode; children: ReactNode }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col sm:h-full">
            <div className="relative isolate flex min-h-0 flex-1 animate-in flex-col items-center overflow-x-hidden overflow-y-auto bg-background px-4 duration-200 fade-in sm:px-10">
                <div className={cn('flex w-full flex-col items-center gap-6 py-10 sm:my-auto', wide ? 'max-w-[480px]' : 'max-w-[400px]')}>{children}</div>
            </div>
            <StepFooter>{footer}</StepFooter>
        </div>
    )
}

// The Orb is the only light in the dialog, and it follows the pointer; once named, the coworker
// stands in its place under its own question. The question and its field are one block; the
// suggestions sit a clear step below, and the templates a step further, as the other way in. A
// named coworker leaves the templates to the name step: it was already chosen over them there.
function JobStep({ suggestions, suggestionsHeading, catalog, read, onCreate, onBrowseTemplates, onBack, still, seed, chosenName, presence }: Omit<NewAgentFormProps, 'still'> & { still?: NewAgentStill; seed?: JobSeed; chosenName?: ChosenAgentName; presence: ReactNode; onBack?: (kept: JobSeed) => void }) {
    const t = useTranslations('dialogs.newAgent')
    const rootRef = useRef<HTMLDivElement>(null)
    const anchorRef = useRef<HTMLSpanElement>(null)
    const gaze = useFollow({ rootRef, anchorRef, cursorRef: still?.cursorRef, aim: still?.aim })
    const { name, described, pending, editing, kept, composer, forYou } = useNewAgentDraft({ suggestions, shown: SUGGESTION_CARDS, read, onCreate, seed: still ?? seed, chosenName })
    const heading = chosenName ? t('jobHeading', { name: chosenName.value }) : name ? t('headingNamed', { name }) : t('heading')

    const lightTop = (presence ? BUDDY_SIZE : ORB_SIZE) / 2
    const title = <h2 className={cn('text-center font-heading text-2xl font-medium tracking-tight', presence ? 'mb-4' : 'mt-5')}>{heading}</h2>

    return (
        <div className="flex min-h-0 flex-1 flex-col sm:h-full">
            <div ref={rootRef} className="relative isolate flex min-h-0 flex-1 animate-in flex-col items-center overflow-x-hidden overflow-y-auto bg-background px-4 duration-200 fade-in sm:overflow-hidden sm:px-10">
                {/* Sits a little above the middle of the dialog, where the eye puts the centre. Under its
                    question, like the other steps, the coworker keeps the same space above it. */}
                <div className={cn('flex w-full max-w-[700px] flex-col items-center pt-6 pb-8 sm:my-auto', presence ? 'sm:pt-5 sm:pb-0' : 'sm:pt-0 sm:pb-12')}>
                    {presence && title}
                    <div className="relative flex w-full flex-col items-center">
                        <div className="hidden sm:contents">
                            <Floor fade={FADE} lights={[floorLight(described)]} style={{ top: lightTop }} />
                            <OrbLight focused={described} top={lightTop} className="z-10" />
                        </div>
                        <div className="relative z-20">
                            <span ref={anchorRef} aria-hidden className="absolute top-1/2 left-1/2" />
                            <div style={{ transform: 'translate(var(--orb-x, 0px), var(--orb-y, 0px))' }}>{presence ?? <Orb state={pending ? 'thinking' : 'listening'} size={ORB_SIZE} gaze={gaze} />}</div>
                        </div>
                        {!presence && title}
                        <Composer {...composer} catalog={catalog} drawnCaret={Boolean(still?.drawnCaret) && !editing} className={cn('w-full', presence ? 'mt-5' : 'mt-6')} />
                        <ForYouCards {...forYou} heading={suggestionsHeading} catalog={catalog} className={cn('w-full', presence ? 'mt-7' : 'mt-9')} />
                        {!presence && <BrowseTemplates onBrowse={onBrowseTemplates} className="mt-7 w-full" />}
                    </div>
                </div>
                {still?.overlay}
            </div>
            {onBack && (
                <StepFooter>
                    <BackButton onClick={() => onBack(kept)} />
                </StepFooter>
            )}
        </div>
    )
}
