import { SEO_DESCRIPTION_MAX_LENGTH, SEO_DESCRIPTION_MIN_LENGTH, type TemplateDocument, isSeoDescriptionLength } from '@rerun/contracts'

// What a template needs before it is worth our review. Deliberately the same list the author sees
// as a checklist and the server enforces on submit, so the button never promises something the
// action then refuses.

export type SubmitRequirementId = 'title' | 'tagline' | 'description' | 'metaDescription' | 'agent' | 'installAnswers' | 'payouts'

export type SubmitRequirement = { id: SubmitRequirementId; label: string; met: boolean }

export type SubmitRequirementCopy = (key: `requirements.${SubmitRequirementId}`, values?: { min: number; max: number }) => string

export function submitRequirementLabel(id: SubmitRequirementId, t: SubmitRequirementCopy): string {
    return id === 'metaDescription' ? t('requirements.metaDescription', { min: SEO_DESCRIPTION_MIN_LENGTH, max: SEO_DESCRIPTION_MAX_LENGTH }) : t(`requirements.${id}`)
}

// Whether the author's Stripe account can receive payouts. Async on the server, already known to
// the panel, so it is passed in rather than resolved here: the checklist stays pure.
export type SubmitContext = { payoutsReady: boolean }

export function templateSubmitChecklist(doc: TemplateDocument, t: SubmitRequirementCopy, context: SubmitContext = { payoutsReady: false }): SubmitRequirement[] {
    const requirements: { id: SubmitRequirementId; met: boolean }[] = [
        { id: 'title', met: doc.title.trim().length > 0 },
        { id: 'tagline', met: doc.tagline.trim().length > 0 },
        { id: 'description', met: doc.longDescription.trim().length > 0 },
        { id: 'metaDescription', met: isSeoDescriptionLength(doc.metaDescription) },
        // No image requirement: the cards draw the board of a captured agent, which the next line
        // already asks for. An author who has one never has to upload a thumbnail to submit.
        { id: 'agent', met: doc.agents.length > 0 },
        { id: 'installAnswers', met: doc.agents.length > 0 && doc.agents.every(agent => agent.setupRequired !== null) },
        ...(doc.pricingModel === 'free' ? [] : [{ id: 'payouts' as const, met: context.payoutsReady }]),
    ]
    return requirements.map(requirement => ({ ...requirement, label: submitRequirementLabel(requirement.id, t) }))
}

export function templateSubmitBlockers(doc: TemplateDocument, t: SubmitRequirementCopy, context?: SubmitContext): string[] {
    return templateSubmitChecklist(doc, t, context)
        .filter(requirement => !requirement.met)
        .map(requirement => requirement.label.toLowerCase())
}
