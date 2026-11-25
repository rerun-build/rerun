import type { Brand } from '@rerun/contracts'
import { z } from 'zod'

// What a preview wears of the brand being edited.
export type BrandDraft = Pick<Brand, 'name' | 'iconUrl' | 'color' | 'supportEmail'>

const draftSchema = z.object({ type: z.literal('organization-brand-draft'), draft: z.object({ name: z.string(), iconUrl: z.string().nullable(), color: z.string().nullable(), supportEmail: z.string().nullable() }) })

export const draftMessage = (draft: BrandDraft) => ({ type: 'organization-brand-draft', draft }) as const

export function readDraftMessage(data: unknown): BrandDraft | null {
    const parsed = draftSchema.safeParse(data)
    return parsed.success ? parsed.data.draft : null
}

export const PREVIEW_READY = { type: 'organization-preview-ready' } as const

export const isPreviewReady = (data: unknown) => (data as { type?: unknown } | null)?.type === PREVIEW_READY.type
