'use client'

import type { TemplateCategory } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { intakePreviewPlan, looksLikeSite, type ForemanIntake } from '@/lib/onboarding/intake'
import { useForemanStore } from '@/stores/foreman.store'
import { EMPTY_DRAFT, furthestReachable, industryHint, intakeSteps, stepAnswered, toIntake, type IntakeDraft, type IntakeStep } from './steps'

const TYPING_PAUSE_MS = 350

export type ForemanIntakeHandlers = {
    onDecideIndustry: (input: string) => Promise<TemplateCategory | null>
    onAnalyzeSite: (url: string) => void
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
    industry: TemplateCategory | null
    deciding: boolean
    siteRead: 'reading' | 'ready' | null
    submitting: boolean
    error: string | null
    set: (patch: Partial<IntakeDraft>) => void
    chooseIndustry: (industry: TemplateCategory) => void
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
    const steps = useMemo(() => intakeSteps(firstName, draft.websiteSkipped), [firstName, draft.websiteSkipped])
    const [decided, setDecided] = useState<TemplateCategory | null>(null)
    const [deciding, setDeciding] = useState(false)
    const [readFor, setReadFor] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const race = useRef(0)
    const sent = useRef<string | null>(null)
    const handlersRef = useRef(handlers)
    useEffect(() => {
        handlersRef.current = handlers
    }, [handlers])

    const industry = draft.industry ?? decided
    const reachable = furthestReachable(steps, draft)
    const canAdvance = reachable > index || steps.every(step => stepAnswered(step, draft))

    const setIntakePreview = useForemanStore(state => state.setIntakePreview)
    useEffect(() => {
        if (!industry) return
        setIntakePreview(intakePreviewPlan(industry))
    }, [industry, setIntakePreview])

    const set = useCallback((patch: Partial<IntakeDraft>) => {
        setError(null)
        const bySite = patch.companyUrl?.trim() ? { websiteSkipped: false, industry: null, industryLabel: '' } : null
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
                setReadFor(input)
            })
    }, [])

    const site = draft.companyUrl.trim()
    const readable = looksLikeSite(site) ? site : null
    const picked = !!draft.industry
    useEffect(() => {
        if (!readable || picked) return
        const timer = setTimeout(() => {
            handlersRef.current.onAnalyzeSite(readable)
            decide(readable)
        }, TYPING_PAUSE_MS)
        return () => clearTimeout(timer)
    }, [readable, picked, decide])

    const skipWebsite = useCallback(() => {
        if (submitting) return
        race.current += 1
        sent.current = null
        setDecided(null)
        setDeciding(false)
        setError(null)
        setDraft(current => ({ ...current, companyUrl: '', websiteSkipped: true }))
        setIndex(index + 1)
    }, [index, submitting])

    const chooseIndustry = useCallback(
        (picked: TemplateCategory) => {
            if (submitting) return
            setError(null)
            setDraft(current => ({ ...current, industry: picked, industryLabel: '' }))
            setIndex(index + 1)
        },
        [index, submitting]
    )

    const submit = useCallback(
        (value: IntakeDraft, decidedIndustry: TemplateCategory | null, ownAsk?: string) => {
            setSubmitting(true)
            setError(null)
            void handlersRef.current
                .onSubmit(toIntake(value, firstName, decidedIndustry), ownAsk)
                .catch(() => setError(t('saveFailed')))
                .finally(() => setSubmitting(false))
        },
        [firstName, t]
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
        if ((steps[index] === 'company' || steps[index] === 'industry') && !draft.industry) {
            const hint = industryHint(draft)
            if (hint) {
                if (looksLikeSite(hint)) handlersRef.current.onAnalyzeSite(hint)
                decide(hint)
            }
        }
        if (index < steps.length - 1) {
            setIndex(index + 1)
            return
        }
        submit(draft, decided)
    }, [canAdvance, decide, decided, draft, index, steps, submit, submitting])

    const sendOwn = useCallback(
        (ownAsk: string) => {
            const asked = ownAsk.trim()
            if (submitting || !asked) return false
            const hint = draft.industry ? null : industryHint(draft)
            if (hint && looksLikeSite(hint) && sent.current !== hint) {
                handlersRef.current.onAnalyzeSite(hint)
                decide(hint)
            }
            submit(draft, decided, asked)
            return true
        },
        [decide, decided, draft, submit, submitting]
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
        siteRead: !readable || picked ? null : readFor === readable ? 'ready' : 'reading',
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
