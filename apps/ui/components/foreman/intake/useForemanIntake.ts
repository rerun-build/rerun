'use client'

import type { IntakeKind, TemplateCategory } from '@moldwright/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { intakePreviewPlan, looksLikeSite, type ForemanIntake } from '@/lib/onboarding/intake'
import { useForemanStore } from '@/stores/foreman.store'
import { EMPTY_DRAFT, furthestReachable, intakeSteps, stepAnswered, toIntake, type IntakeDraft, type IntakeStep } from './steps'

const TYPING_PAUSE_MS = 350

export type ForemanIntakeHandlers = {
    onDecideIndustry: (input: string) => Promise<TemplateCategory | null>
    onProposeTeams: (words: string) => Promise<string[] | null>
    onAnalyzeSite: (url: string) => Promise<unknown>
    onSubmit: (intake: ForemanIntake, ownAsk?: string) => Promise<void>
}

export type ForemanIntakeController = {
    steps: IntakeStep[]
    step: IntakeStep
    index: number
    last: boolean
    answered: boolean[]
    reachable: number
    canAdvance: boolean
    draft: IntakeDraft
    industry: IntakeKind | null
    deciding: boolean
    siteRead: 'reading' | 'ready' | null
    submitting: boolean
    error: string | null
    set: (patch: Partial<IntakeDraft>) => void
    chooseIndustry: (industry: IntakeKind) => void
    chooseRole: (position: string) => void
    skipWebsite: () => void
    goTo: (index: number) => void
    back: () => void
    next: () => void
    sendOwn: (ownAsk: string) => boolean
}

export function useForemanIntake({ firstName, handlers }: { firstName: string | null; handlers: ForemanIntakeHandlers }): ForemanIntakeController {
    const t = useTranslations('foreman.intake')
    const [index, setIndex] = useState(0)
    const [draft, setDraft] = useState<IntakeDraft>(EMPTY_DRAFT)
    const steps = useMemo(() => intakeSteps(firstName), [firstName])
    const [decided, setDecided] = useState<TemplateCategory | null>(null)
    const [proposal, setProposal] = useState<{ words: string; boxes: string[] | null } | null>(null)
    const [deciding, setDeciding] = useState(false)
    const [readFor, setReadFor] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const race = useRef(0)
    const sent = useRef<string | null>(null)
    const proposing = useRef(0)
    const proposed = useRef<string | null>(null)
    const handlersRef = useRef(handlers)
    useEffect(() => {
        handlersRef.current = handlers
    }, [handlers])

    const industry = draft.industry ?? decided
    const reachable = furthestReachable(steps, draft)
    const canAdvance = reachable > index || steps.every(step => stepAnswered(step, draft))
    const words = draft.industry ? '' : draft.industryLabel.trim()
    const teamsSettled = !!words && proposal?.words === words
    const teams = teamsSettled ? (proposal?.boxes ?? null) : null
    const kindGiven = !!draft.industry || !!words

    const setIntakePreview = useForemanStore(state => state.setIntakePreview)
    useEffect(() => {
        if (words) {
            if (teamsSettled) setIntakePreview(intakePreviewPlan(null, teams))
            return
        }
        if (!industry) return
        setIntakePreview(intakePreviewPlan(industry))
    }, [industry, words, teamsSettled, teams, setIntakePreview])

    const set = useCallback((patch: Partial<IntakeDraft>) => {
        setError(null)
        const bySite = patch.companyUrl?.trim() ? { websiteSkipped: false } : null
        setDraft(current => ({ ...current, ...patch, ...bySite }))
    }, [])

    const decide = useCallback((input: string) => {
        if (sent.current === input) return
        sent.current = input
        const token = (race.current += 1)
        setDeciding(true)
        void handlersRef.current
            .onDecideIndustry(input)
            .then(found => {
                if (race.current !== token) return
                setDecided(found)
            })
            .catch(() => {})
            .finally(() => {
                if (race.current !== token) return
                setDeciding(false)
            })
    }, [])

    const propose = useCallback((input: string) => {
        if (proposed.current === input) return
        proposed.current = input
        const token = (proposing.current += 1)
        void handlersRef.current
            .onProposeTeams(input)
            .catch(() => null)
            .then(boxes => {
                if (proposing.current === token) setProposal({ words: input, boxes })
            })
    }, [])

    const analyze = useCallback((url: string) => {
        void handlersRef.current
            .onAnalyzeSite(url)
            .catch(() => {})
            .finally(() => setReadFor(url))
    }, [])

    const site = draft.companyUrl.trim()
    const readable = looksLikeSite(site) ? site : null
    useEffect(() => {
        if (!readable) return
        const timer = setTimeout(() => {
            analyze(readable)
            if (!kindGiven) decide(readable)
        }, TYPING_PAUSE_MS)
        return () => clearTimeout(timer)
    }, [readable, kindGiven, analyze, decide])

    const skipWebsite = useCallback(() => {
        if (submitting) return
        setError(null)
        setDraft(current => ({ ...current, companyUrl: '', websiteSkipped: true }))
        setIndex(index + 1)
    }, [index, submitting])

    const chooseIndustry = useCallback(
        (picked: IntakeKind) => {
            if (submitting) return
            setError(null)
            setDraft(current => ({ ...current, industry: picked, industryLabel: '' }))
            setIndex(index + 1)
        },
        [index, submitting]
    )

    const submit = useCallback(
        (value: IntakeDraft, decidedIndustry: TemplateCategory | null, ownAsk?: string) => {
            proposing.current += 1
            setSubmitting(true)
            setError(null)
            void handlersRef.current
                .onSubmit(toIntake(value, firstName, decidedIndustry, teams), ownAsk)
                .catch(() => setError(t('saveFailed')))
                .finally(() => setSubmitting(false))
        },
        [firstName, t, teams]
    )

    const chooseRole = useCallback(
        (position: string) => {
            if (submitting) return
            setError(null)
            const chosen = { ...draft, position }
            setDraft(chosen)
            if (index < steps.length - 1) {
                setIndex(index + 1)
                return
            }
            submit(chosen, decided)
        },
        [decided, draft, index, steps, submit, submitting]
    )

    const goTo = useCallback(
        (target: number) => {
            if (submitting) return
            setIndex(Math.min(Math.max(target, 0), reachable))
        },
        [reachable, submitting]
    )

    const next = useCallback(() => {
        if (submitting || !canAdvance) return
        if (steps[index] === 'industry' && words) {
            decide(words)
            propose(words)
        }
        if (steps[index] === 'company' && readable) {
            analyze(readable)
            if (!kindGiven) decide(readable)
        }
        if (index < steps.length - 1) {
            setIndex(index + 1)
            return
        }
        submit(draft, decided)
    }, [analyze, canAdvance, decide, decided, draft, index, kindGiven, propose, readable, steps, submit, submitting, words])

    const sendOwn = useCallback(
        (ownAsk: string) => {
            const asked = ownAsk.trim()
            if (submitting || !asked) return false
            if (readable) {
                analyze(readable)
                if (!kindGiven) decide(readable)
            }
            submit(draft, decided, asked)
            return true
        },
        [analyze, decide, decided, draft, kindGiven, readable, submit, submitting]
    )

    return {
        steps,
        step: steps[index],
        index,
        last: index === steps.length - 1,
        answered: steps.map(step => stepAnswered(step, draft)),
        reachable,
        canAdvance,
        draft,
        industry,
        deciding,
        siteRead: !readable ? null : readFor === readable ? 'ready' : 'reading',
        submitting,
        error,
        set,
        chooseIndustry,
        chooseRole,
        skipWebsite,
        goTo,
        back: () => goTo(index - 1),
        next,
        sendOwn,
    }
}
