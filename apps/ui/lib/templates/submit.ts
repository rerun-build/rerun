import { SEO_DESCRIPTION_MAX_LENGTH, SEO_DESCRIPTION_MIN_LENGTH, type TemplateDocument, isSeoDescriptionLength } from '@rerun/contracts'

export type SubmitRequirementId = 'title' | 'tagline' | 'description' | 'metaDescription' | 'agent' | 'installAnswers' | 'payouts'

export type SubmitRequirement = { id: SubmitRequirementId; label: string; met: boolean }

export type SubmitRequirementCopy = (key: `requirements.${SubmitRequirementId}`, values?: { min: number; max: number }) => string

export function submitRequirementLabel(id: SubmitRequirementId, t: SubmitRequirementCopy): string {
    return id === 'metaDescription' ? t('requirements.metaDescription', { min: SEO_DESCRIPTION_MIN_LENGTH, max: SEO_DESCRIPTION_MAX_LENGTH }) : t(`requirements.${id}`)
}

export type SubmitContext = { payoutsReady: boolean }

export function templateSubmitChecklist(doc: TemplateDocument, t: SubmitRequirementCopy, context: SubmitContext = { payoutsReady: false }): SubmitRequirement[] {
    const requirements: { id: SubmitRequirementId; met: boolean }[] = [
        { id: 'title', met: doc.title.trim().length > 0 },
        { id: 'tagline', met: doc.tagline.trim().length > 0 },
        { id: 'description', met: doc.longDescription.trim().length > 0 },
        { id: 'metaDescription', met: isSeoDescriptionLength(doc.metaDescription) },
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
