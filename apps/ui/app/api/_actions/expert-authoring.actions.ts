'use server'

import { assertTemplateOwnedByUser } from '@/app/api/_auth/expert'
import {
    runAltTextPrefill,
    runContentPrefill,
    runFaqPrefill,
    runImageUpload,
    runMetaPrefill,
    type AltTextResult,
    type ContentPrefillResult,
    type FaqPrefillResult,
    type MetaPrefillResult,
    type UploadResult,
} from '@/lib/templates/authoring'
import { templateEditBlockCode } from '@/lib/templates/expert'
import { failure, failureOf } from '@/lib/i18n/action-error'

// The authoring surface, author side: the same five jobs the admin console runs, gated on owning an
// editable template instead of on being an admin. Nothing here writes the row, so the guard only
// has to establish that the caller is entitled to spend our credits on this template.

async function assertEditable(templateId: string) {
    const owned = await assertTemplateOwnedByUser(templateId)
    return templateEditBlockCode(owned.status)
}

export async function uploadMyTemplateImageAction(templateId: string, formData: FormData): Promise<UploadResult> {
    try {
        const blocked = await assertEditable(templateId)
        if (blocked) return failure(blocked)

        // An author never overrides the social card, so the folder is not theirs to choose.
        return await runImageUpload(formData, 'gallery')
    } catch (err) {
        return failureOf(err, 'uploadImageFailed')
    }
}

export async function prefillMyTemplateContentAction(templateId: string, input: unknown): Promise<ContentPrefillResult> {
    try {
        const blocked = await assertEditable(templateId)
        if (blocked) return failure(blocked)

        return await runContentPrefill(input)
    } catch (err) {
        return failureOf(err, 'writeContentFailed')
    }
}

// No `currentSlug`: the author does not own the URL of the page, so nothing comes back for it.
export async function prefillMyTemplateMetaAction(templateId: string, input: unknown): Promise<MetaPrefillResult> {
    try {
        const blocked = await assertEditable(templateId)
        if (blocked) return failure(blocked)

        return await runMetaPrefill(input)
    } catch (err) {
        return failureOf(err, 'writeMetadataFailed')
    }
}

export async function prefillMyTemplateFaqAction(templateId: string, input: unknown): Promise<FaqPrefillResult> {
    try {
        const blocked = await assertEditable(templateId)
        if (blocked) return failure(blocked)

        return await runFaqPrefill(input)
    } catch (err) {
        return failureOf(err, 'writeFaqFailed')
    }
}

export async function prefillMyTemplateAltTextAction(templateId: string, input: unknown): Promise<AltTextResult> {
    try {
        const blocked = await assertEditable(templateId)
        if (blocked) return failure(blocked)

        return await runAltTextPrefill(input)
    } catch (err) {
        return failureOf(err, 'writeAltTextFailed')
    }
}
