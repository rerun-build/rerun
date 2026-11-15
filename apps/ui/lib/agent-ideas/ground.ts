import { clean } from '@/lib/templates/voice'
import type { AgentCandidate, CatalogApp, CompanyDossier, DroppedCandidate, GroundResult, GroundedCandidate, IdeaConnector } from './types'

const NAME_MAX = 40
const ROLE_MAX = 110
const SENTENCE_MAX = 200
const STEP_MAX = 140
const WHEN_MAX = 60
const KICKOFF_MAX = 400

const key = (value: string) => value.trim().toLowerCase()

function toConnector({ slug, name, category, icon }: CatalogApp): IdeaConnector {
    return { slug, name, category, icon }
}

export function groundCandidates(candidates: AgentCandidate[], dossier: Pick<CompanyDossier, 'evidence' | 'existingAgents'>, catalog: CatalogApp[]): GroundResult {
    const evidenceById = new Map(dossier.evidence.map(item => [item.id, item]))
    const bySlug = new Map(catalog.map(app => [key(app.slug), app]))
    const byName = new Map(catalog.map(app => [key(app.name), app]))
    const taken = new Set(dossier.existingAgents.map(agent => key(agent.name)))

    const grounded: GroundedCandidate[] = []
    const dropped: DroppedCandidate[] = []

    for (const candidate of candidates) {
        const name = clean(candidate.name, NAME_MAX)
        const role = clean(candidate.role, ROLE_MAX)
        const drop = (reason: string) => dropped.push({ name, role, reason })

        if (taken.has(key(name))) {
            drop('Porte le nom d’un coworker existant ou d’un autre candidat')
            continue
        }
        const evidence = [...new Set(candidate.evidenceIds)].flatMap(id => evidenceById.get(id.trim().replace(/^\[|\]$/g, '')) ?? [])
        if (!evidence.length) {
            drop('Ne cite aucune preuve du dossier')
            continue
        }

        const connectors = new Map<string, IdeaConnector>()
        const missing = new Set<string>()
        for (const wanted of [...candidate.connectors, ...candidate.missingApps]) {
            const app = bySlug.get(key(wanted)) ?? byName.get(key(wanted))
            if (app) connectors.set(app.slug, toConnector(app))
            else if (wanted.trim()) missing.add(wanted.trim())
        }

        taken.add(key(name))
        grounded.push({
            name,
            role,
            hook: clean(candidate.hook, SENTENCE_MAX),
            lens: candidate.lens,
            evidence,
            steps: candidate.steps.map(step => clean(step, STEP_MAX)).filter(Boolean),
            when: clean(candidate.when, WHEN_MAX),
            connectors: [...connectors.values()],
            missingApps: [...missing],
            firstRun: clean(candidate.firstRun, SENTENCE_MAX),
            kickoff: clean(candidate.kickoff, KICKOFF_MAX),
        })
    }

    return { grounded, dropped }
}
