import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TEMPLATE_CATEGORIES } from '@rerun/contracts'
import { z } from 'zod'
import type { ForemanIntake } from '@/lib/onboarding/intake'
import type { PendingAgentDraft } from './board.store'

const spaceOffsetSchema = z.object({ col: z.number().int(), row: z.number().int() })
export type SpaceOffset = z.infer<typeof spaceOffsetSchema>

const pendingFirstAgentSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    serviceSlugs: z.array(z.string()),
    kickoff: z.string().optional(),
    offset: spaceOffsetSchema.optional(),
})

export type PendingFirstAgent = PendingAgentDraft & { offset?: SpaceOffset }

const pendingTemplateSchema = z.object({
    slug: z.string().min(1),
    title: z.string().min(1),
    agentCount: z.number().int().nonnegative(),
    offsets: z.array(spaceOffsetSchema).optional(),
    needsPlacement: z.boolean().optional(),
})

export type PendingTemplate = z.infer<typeof pendingTemplateSchema>

const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES)

const pendingIntakeSchema = z.object({
    companyUrl: z.string().nullable(),
    industry: templateCategorySchema.nullable(),
    decidedIndustry: templateCategorySchema.nullable(),
    industryLabel: z.string().nullable(),
    position: z.string().nullable(),
    firstName: z.string().nullable(),
}) satisfies z.ZodType<ForemanIntake>

const pendingTemplateLinkSchema = z.string().min(1)
const pendingShareLinkSchema = z.string().min(1)

const PARKED_TTL_MS = 24 * 60 * 60 * 1000

type ParkedEntry = 'pendingFirstAgent' | 'pendingTemplate' | 'pendingTemplateLink' | 'pendingShareLink' | 'pendingIntake' | 'resumeRequested'
type ParkedAt = Partial<Record<ParkedEntry, number>>

export type OnboardingState = {
    pendingFirstAgent: PendingFirstAgent | null
    pendingTemplate: PendingTemplate | null
    pendingTemplateLink: string | null
    pendingShareLink: string | null
    pendingIntake: ForemanIntake | null
    pendingOwnAsk: string | null
    resumeRequested: boolean
    firstAgentFromPrompt: boolean
    parkedAt: ParkedAt
    setPendingFirstAgent: (draft: PendingFirstAgent) => void
    clearPendingFirstAgent: () => void
    setPendingTemplate: (template: PendingTemplate) => void
    clearPendingTemplate: () => void
    setPendingTemplateLink: (slug: string) => void
    clearPendingTemplateLink: () => void
    setPendingShareLink: (token: string) => void
    clearPendingShareLink: () => void
    setPendingIntake: (intake: ForemanIntake, ownAsk?: string | null) => void
    clearPendingIntake: () => void
    markResume: () => void
    consumeResume: () => boolean
    markFirstAgentFromPrompt: () => void
}

type PersistedOnboarding = Pick<
    OnboardingState,
    'pendingFirstAgent' | 'pendingTemplate' | 'pendingTemplateLink' | 'pendingShareLink' | 'pendingIntake' | 'pendingOwnAsk' | 'resumeRequested' | 'firstAgentFromPrompt' | 'parkedAt'
>

export function parsePersistedOnboarding(raw: unknown, now = Date.now()): PersistedOnboarding {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PersistedOnboarding, unknown>>
    const stamps = (p.parkedAt && typeof p.parkedAt === 'object' ? p.parkedAt : {}) as Partial<Record<ParkedEntry, unknown>>
    const parkedAt: ParkedAt = {}
    function fresh<T>(entry: ParkedEntry, schema: z.ZodType<T>): T | null {
        const stamp = stamps[entry]
        if (p[entry] == null || typeof stamp !== 'number' || now - stamp >= PARKED_TTL_MS) return null
        const parsed = schema.safeParse(p[entry])
        if (!parsed.success) return null
        parkedAt[entry] = stamp
        return parsed.data
    }
    const pendingFirstAgent = fresh('pendingFirstAgent', pendingFirstAgentSchema)
    const pendingIntake = fresh('pendingIntake', pendingIntakeSchema)
    const ownAsk = typeof p.pendingOwnAsk === 'string' ? p.pendingOwnAsk.trim() : ''
    return {
        pendingFirstAgent,
        pendingTemplate: fresh('pendingTemplate', pendingTemplateSchema),
        pendingTemplateLink: fresh('pendingTemplateLink', pendingTemplateLinkSchema),
        pendingShareLink: fresh('pendingShareLink', pendingShareLinkSchema),
        pendingIntake,
        pendingOwnAsk: pendingIntake && ownAsk ? ownAsk : null,
        resumeRequested: fresh('resumeRequested', z.literal(true)) === true,
        firstAgentFromPrompt: pendingFirstAgent !== null && p.firstAgentFromPrompt === true,
        parkedAt,
    }
}

export function hasPendingStart(state: Pick<OnboardingState, 'pendingFirstAgent' | 'pendingTemplate' | 'pendingShareLink'>): boolean {
    return !!state.pendingFirstAgent || !!state.pendingTemplate || !!state.pendingShareLink
}

export const useOnboardingStore = create<OnboardingState>()(
    persist(
        (set, get) => ({
            pendingFirstAgent: null,
            pendingTemplate: null,
            pendingTemplateLink: null,
            pendingShareLink: null,
            pendingIntake: null,
            pendingOwnAsk: null,
            resumeRequested: false,
            firstAgentFromPrompt: false,
            parkedAt: {},
            setPendingFirstAgent: draft => set(s => ({ pendingFirstAgent: draft, pendingTemplate: null, parkedAt: { ...s.parkedAt, pendingFirstAgent: Date.now() } })),
            clearPendingFirstAgent: () => set({ pendingFirstAgent: null, firstAgentFromPrompt: false }),
            setPendingTemplate: template => set(s => ({ pendingTemplate: template, pendingFirstAgent: null, firstAgentFromPrompt: false, parkedAt: { ...s.parkedAt, pendingTemplate: Date.now() } })),
            clearPendingTemplate: () => set({ pendingTemplate: null }),
            setPendingTemplateLink: slug => set(s => ({ pendingTemplateLink: slug, parkedAt: { ...s.parkedAt, pendingTemplateLink: Date.now() } })),
            clearPendingTemplateLink: () => set({ pendingTemplateLink: null }),
            setPendingShareLink: token => set(s => ({ pendingShareLink: token, parkedAt: { ...s.parkedAt, pendingShareLink: Date.now() } })),
            clearPendingShareLink: () => set({ pendingShareLink: null }),
            setPendingIntake: (intake, ownAsk = null) => set(s => ({ pendingIntake: intake, pendingOwnAsk: ownAsk?.trim() || null, parkedAt: { ...s.parkedAt, pendingIntake: Date.now() } })),
            clearPendingIntake: () => set({ pendingIntake: null, pendingOwnAsk: null }),
            markResume: () => set(s => ({ resumeRequested: true, parkedAt: { ...s.parkedAt, resumeRequested: Date.now() } })),
            consumeResume: () => {
                if (!get().resumeRequested) return false
                set({ resumeRequested: false })
                return true
            },
            markFirstAgentFromPrompt: () => set({ firstAgentFromPrompt: true }),
        }),
        {
            name: 'rerun:pending-first-agent',
            partialize: state => ({
                pendingFirstAgent: state.pendingFirstAgent,
                pendingTemplate: state.pendingTemplate,
                pendingTemplateLink: state.pendingTemplateLink,
                pendingShareLink: state.pendingShareLink,
                pendingIntake: state.pendingIntake,
                pendingOwnAsk: state.pendingOwnAsk,
                resumeRequested: state.resumeRequested,
                firstAgentFromPrompt: state.firstAgentFromPrompt,
                parkedAt: state.parkedAt,
            }),
            merge: (persisted, current) => ({ ...current, ...parsePersistedOnboarding(persisted) }),
        }
    )
)
