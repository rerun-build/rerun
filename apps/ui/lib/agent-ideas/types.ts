import type { CollectorCost } from '@/lib/company/explore/types'

export type Evidence = { id: string; source: string; topic: string; text: string }

export type EvidenceDraft = Omit<Evidence, 'id'>

export type ExistingAgent = { name: string; description: string }

export type CompanyDossier = {
    workspaceId: number
    companyName: string | null
    evidence: Evidence[]
    existingAgents: ExistingAgent[]
    warnings: string[]
}

export const LENSES = ['acquisition', 'sales', 'delivery', 'support', 'backoffice', 'watch', 'content'] as const
export type Lens = (typeof LENSES)[number]

export type Opportunity = {
    job: string
    lens: Lens
    who: string
    cadence: string
    tool: string
    friction: string
    evidenceIds: string[]
}

export type AgentCandidate = {
    name: string
    role: string
    hook: string
    lens: Lens
    evidenceIds: string[]
    steps: string[]
    when: string
    connectors: string[]
    missingApps: string[]
    firstRun: string
    kickoff: string
}

export type CatalogApp = { slug: string; name: string; category: string; summary: string; icon: string | null }

export type IdeaConnector = Pick<CatalogApp, 'slug' | 'name' | 'category' | 'icon'>

export type GroundedCandidate = Omit<AgentCandidate, 'evidenceIds' | 'connectors'> & {
    evidence: Evidence[]
    connectors: IdeaConnector[]
}

export type DroppedCandidate = { name: string; role: string; reason: string }

export type GroundResult = { grounded: GroundedCandidate[]; dropped: DroppedCandidate[] }

export const CRITERIA = ['specificity', 'evidence', 'feasibility', 'value', 'novelty'] as const
export type Criterion = (typeof CRITERIA)[number]

export type CriterionScore = { score: number; level: number; confidence: number }

export type JudgedCandidate = GroundedCandidate & { scores: Record<Criterion, CriterionScore> }

export type Verdict = { keep: boolean; weakest: Criterion; reason: string }

export type AgentIdea = JudgedCandidate & { total: number; verdict: Verdict }

export type Selection = { kept: AgentIdea[]; rejected: AgentIdea[]; eligible: AgentIdea[] }

export const SUGGEST_STEPS = ['dossier', 'diagnose', 'design', 'ground', 'judge', 'select'] as const
export type SuggestStep = (typeof SUGGEST_STEPS)[number]

export type StepData = {
    dossier: CompanyDossier
    diagnose: Opportunity[]
    design: AgentCandidate[]
    ground: GroundResult
    judge: JudgedCandidate[]
    select: Selection
}

export type StepOutput<K extends SuggestStep = SuggestStep> = { data: StepData[K]; highlights: string[]; cost?: CollectorCost }

export type SuggestEvent = { type: 'running'; step: SuggestStep } | { [K in SuggestStep]: { type: 'done'; step: K; durationMs: number; output: StepOutput<K> } }[SuggestStep] | { type: 'error'; step: SuggestStep; durationMs: number; error: string } | { type: 'end'; durationMs: number }

export const STEP_CATALOG: Record<SuggestStep, { label: string; description: string }> = {
    dossier: { label: 'Dossier', description: 'Brain, trouvailles et réponses d’onboarding, aplatis en preuves numérotées' },
    diagnose: { label: 'Diagnostic', description: 'Le travail récurrent de cette entreprise, fonction par fonction' },
    design: { label: 'Conception', description: 'Un coworker candidat par opportunité, avec ses apps et son premier run' },
    ground: { label: 'Ancrage', description: 'Preuves et apps vérifiées contre le dossier et le catalogue, sans modèle' },
    judge: { label: 'Jury', description: 'Jev note chaque candidat sur cinq critères' },
    select: { label: 'Sélection', description: 'Planchers, diversité des fonctions, cinq idées au plus' },
}
