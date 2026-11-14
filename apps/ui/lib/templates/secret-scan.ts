import { scanTextForSecrets, type TemplateDocument } from '@rerun/contracts'

export type SecretHit = { where: string; label: string }

function scanText(text: string, where: string, hits: SecretHit[]) {
    for (const label of scanTextForSecrets(text)) hits.push({ where, label })
}

export function scanDocumentForSecrets(doc: TemplateDocument): SecretHit[] {
    const hits: SecretHit[] = []
    scanText(doc.tagline, 'The tagline', hits)
    scanText(doc.longDescription, 'The description', hits)
    for (const item of doc.faq) scanText(item.answer, `The answer to "${item.question}"`, hits)
    for (const agent of doc.agents) {
        scanText(agent.description, `Coworker "${agent.key}"`, hits)
        for (const skill of agent.skills) scanText(skill.description, `Skill "${skill.name}"`, hits)
        for (const trigger of agent.triggers) scanText(trigger.description, `Webhook "${trigger.name}"`, hits)
    }
    return hits
}

export function describeSecretHit(hit: SecretHit): string {
    return `${hit.where} looks like it contains a credential (${hit.label})`
}
