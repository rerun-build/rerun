import { EMPTY_DRAFT, industryHint, intakeSteps, looksLikeSite, stepAnswered, toIntake, type ForemanIntakeRequest, type IntakeDraft, type TemplateCategory } from '@rerun/contracts'
import { useRef, useState } from 'react'

const INDUSTRY_WAIT_MS = 2500

type IntakeOptions = {
    knownFirstName: string | null
    // The fast guess at an industry from a site, made while the next questions are being answered.
    decideIndustry: (input: string) => Promise<TemplateCategory | null>
    submit: (intake: ForemanIntakeRequest) => Promise<void>
    initial?: Partial<IntakeDraft>
    initialIndex?: number
}

// The welcome card's state, the web card's order: the site, the line of work only when there is no site,
// the role, then the first name only when nobody gave it yet.
export function useIntake({ knownFirstName, decideIndustry, submit, initial, initialIndex = 0 }: IntakeOptions) {
    const [draft, setDraft] = useState<IntakeDraft>({ ...EMPTY_DRAFT, ...initial })
    const [index, setIndex] = useState(initialIndex)
    const [decided, setDecided] = useState<TemplateCategory | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [saveFailed, setSaveFailed] = useState(false)
    const [deciding, setDeciding] = useState(false)
    const asked = useRef(0)

    const steps = intakeSteps(knownFirstName, draft.websiteSkipped)
    const step = steps[Math.min(index, steps.length - 1)]
    const last = index >= steps.length - 1

    // Asked as the site or the typed line of work is left behind, so the role question offers the roles of
    // its industry rather than swapping its options under the finger. It waits a moment for the guess, then
    // falls back on the roles every business has.
    const guessIndustry = (final: IntakeDraft) => {
        const hint = industryHint(final)
        if (!hint || final.industry || (step === 'company' && !looksLikeSite(hint))) return
        const ask = ++asked.current
        const settle = (industry: TemplateCategory | null) => {
            if (ask !== asked.current) return
            if (industry) setDecided(industry)
            setDeciding(false)
        }
        setDeciding(true)
        setTimeout(() => settle(null), INDUSTRY_WAIT_MS)
        decideIndustry(hint)
            .then(settle)
            .catch(() => settle(null))
    }

    const set = (patch: Partial<IntakeDraft>) => {
        setSaveFailed(false)
        setDraft(current => ({ ...current, ...patch }))
    }

    const finish = async (final: IntakeDraft) => {
        setSubmitting(true)
        try {
            await submit(toIntake(final, knownFirstName, decided))
        } catch {
            setSaveFailed(true)
            setSubmitting(false)
        }
    }

    const next = (final: IntakeDraft = draft) => {
        if (!stepAnswered(step, final) || submitting) return
        if (step === 'company' || step === 'industry') guessIndustry(final)
        if (last) return void finish(final)
        setIndex(current => current + 1)
    }

    // A choice answers its step on the spot, as an option of a question does.
    const choose = (patch: Partial<IntakeDraft>) => {
        const final = { ...draft, ...patch }
        setDraft(final)
        next(final)
    }

    const skipWebsite = () => {
        const final = { ...draft, companyUrl: '', websiteSkipped: true }
        setDraft(final)
        setIndex(1)
    }

    const back = () => {
        setSaveFailed(false)
        if (index === 0) return
        // Back on the site question, the line of work is asked again only if they pass on it again.
        if (index === 1 && draft.websiteSkipped) set({ websiteSkipped: false })
        setIndex(current => current - 1)
    }

    return { step, steps, index, draft, industry: draft.industry ?? decided, deciding, submitting, saveFailed, canAdvance: stepAnswered(step, draft), last, set, choose, next, back, skipWebsite }
}

export type IntakeController = ReturnType<typeof useIntake>
