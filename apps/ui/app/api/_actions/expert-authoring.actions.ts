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

async function assertEditable(templateId: string) {
    const owned = await assertTemplateOwnedByUser(templateId)
    return templateEditBlockCode(owned.status)
}

export async function uploadMyTemplateImageAction(templateId: string, formData: FormData): Promise<UploadResult> {
    try {
        const blocked = await assertEditable(templateId)
        if (blocked) return failure(blocked)

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
