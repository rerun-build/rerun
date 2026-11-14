'use server'

import { z } from 'zod'
import { requireExpertUserId } from '@/app/api/_auth/expert'
import {
    createAuthorTemplateDraft,
    deleteAuthorTemplate,
    listAuthorTemplates,
    loadAuthorTemplate,
    submitAuthorTemplate,
    updateAuthorTemplate,
    withdrawAuthorTemplate,
} from '@/lib/templates/author'
import { templateAuthorSchema, type ExpertTemplate, type ExpertTemplateDetail } from '@/lib/templates/expert'

import type { ActionResult } from './space.actions'
import { failureOf } from '@/lib/i18n/action-error'

export async function listMyTemplatesAction(): Promise<ActionResult<{ templates: ExpertTemplate[] }>> {
    try {
        return { ok: true, templates: await listAuthorTemplates(await requireExpertUserId()) }
    } catch (err) {
        return failureOf(err, 'loadTemplatesFailed')
    }
}

export async function getMyTemplateAction(id: string): Promise<ActionResult<{ template: ExpertTemplateDetail }>> {
    try {
        return { ok: true, template: await loadAuthorTemplate(await requireExpertUserId(), id) }
    } catch (err) {
        return failureOf(err, 'loadTemplateFailed')
    }
}

export async function createMyTemplateDraftAction(title: string): Promise<ActionResult<{ id: string }>> {
    try {
        const { id } = await createAuthorTemplateDraft(await requireExpertUserId(), title)
        return { ok: true, id }
    } catch (err) {
        return failureOf(err, 'createTemplateFailed')
    }
}

const updateInputSchema = templateAuthorSchema.extend({ id: z.string().uuid() })

export async function updateMyTemplateAction(input: unknown): Promise<ActionResult> {
    try {
        const { id, ...patch } = updateInputSchema.parse(input)
        await updateAuthorTemplate(await requireExpertUserId(), id, patch)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'saveTemplateFailed')
    }
}

export async function submitMyTemplateAction(id: string): Promise<ActionResult> {
    try {
        await submitAuthorTemplate(await requireExpertUserId(), id)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'submitTemplateFailed')
    }
}

export async function withdrawMyTemplateAction(id: string): Promise<ActionResult> {
    try {
        await withdrawAuthorTemplate(await requireExpertUserId(), id)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'withdrawTemplateFailed')
    }
}

export async function deleteMyTemplateAction(id: string): Promise<ActionResult> {
    try {
        await deleteAuthorTemplate(await requireExpertUserId(), id)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'deleteTemplateFailed')
    }
}
