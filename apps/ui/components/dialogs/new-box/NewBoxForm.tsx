'use client'

import { Orb } from '@rerun/ui/foreman'
import { useFollow } from '@rerun/ui/new-agent'
import { useTranslations } from 'next-intl'
import { type ReactNode, type RefObject, useRef } from 'react'

import { Form } from '@/components/ui/form'

import { BoxComposer } from './BoxComposer'
import { BoxPreview } from './BoxPreview'
import { DEFAULT_PLACEHOLDER_EFFECT, type PlaceholderEffect } from './placeholder-effects'
import { useBoxDraft } from './useBoxDraft'

const STAGE_FADE = 'linear-gradient(to bottom, transparent 0%, #000 12%, #000 72%, transparent 100%)'

// A moment the form is opened on, for a capture: the name it starts with, the Box drawn finished
// rather than tracing itself, and the drawn caret and cursor a screenshot cannot take.
export type NewBoxStill = { name: string; frozen?: boolean; drawnCaret?: boolean; aim?: string; cursorRef?: RefObject<HTMLDivElement | null>; overlay?: ReactNode }

// The Box leads, alone and large, with the Foreman standing in it; the field comes after, where the
// eye lands once it has seen what it is naming.
//
// Nothing is created here: `onCreate` receives the name, and what it throws is shown under the field.
export type NewBoxIntro = { heading: string; description: string }

export function NewBoxForm({
    suggestions,
    onCreate,
    controls,
    placeholderEffect = DEFAULT_PLACEHOLDER_EFFECT,
    still,
    intro,
}: {
    suggestions: string[]
    onCreate: (name: string) => Promise<void>
    controls?: ReactNode
    placeholderEffect?: PlaceholderEffect
    still?: NewBoxStill
    intro?: NewBoxIntro
}) {
    const t = useTranslations('dialogs.newBox')
    const { heading, description } = intro ?? { heading: t('heading'), description: t('description') }
    const rootRef = useRef<HTMLFormElement>(null)
    const anchorRef = useRef<HTMLSpanElement>(null)
    const draft = useBoxDraft({ initialName: still?.name ?? '', frozen: Boolean(still?.frozen) })
    const gaze = useFollow({ rootRef, anchorRef, cursorRef: still?.cursorRef, aim: still?.aim })
    const {
        formState: { isSubmitting, errors },
    } = draft.form

    const onSubmit = draft.form.handleSubmit(async ({ name }) => {
        try {
            await onCreate(name)
        } catch (error) {
            draft.form.setError('root', { message: error instanceof Error ? error.message : t('failed') })
        }
    })

    return (
        <Form {...draft.form}>
            <form ref={rootRef} onSubmit={onSubmit} className="relative isolate flex min-h-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto bg-background px-4 [--stage:200px] sm:h-full sm:overflow-hidden sm:px-10 sm:[--stage:340px]">
                <BoxPreview
                    name={draft.named ? draft.trimmed : null}
                    drawKey={draft.drawKey}
                    mask={STAGE_FADE}
                    onFloor={
                        <div className="flex flex-col items-center pb-1">
                            <div className="relative">
                                <span ref={anchorRef} aria-hidden className="absolute top-1/2 left-1/2" />
                                <div style={{ transform: 'translate(var(--orb-x, 0px), var(--orb-y, 0px))' }}>
                                    <Orb state={draft.named ? 'thinking' : 'listening'} size={44} gaze={gaze} />
                                </div>
                            </div>
                            <span className="mt-3 h-2.5 w-9 rounded-[50%] bg-black/30 blur-[3px] dark:bg-black/70" />
                        </div>
                    }
                    className="absolute inset-x-0 top-0 h-(--stage)"
                />
                {/* The sheet this becomes on a phone drops the safe-area padding of the frame, so the
                    last row carries it. */}
                <div className="relative z-20 flex w-full max-w-[640px] flex-col items-center pt-[calc(var(--stage)_-_16px)] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-0">
                    <h2 className="text-center font-heading text-2xl font-medium tracking-tight">{heading}</h2>
                    <p className="mt-1.5 text-center text-sm text-muted-foreground">{description}</p>
                    <BoxComposer draft={draft} suggestions={suggestions} placeholderEffect={still?.frozen ? 'static' : placeholderEffect} controls={controls} creating={isSubmitting} error={errors.root?.message} autoFocus={!still} drawnCaret={Boolean(still?.drawnCaret)} className="mt-6 w-full" />
                </div>
                {still?.overlay}
            </form>
        </Form>
    )
}
