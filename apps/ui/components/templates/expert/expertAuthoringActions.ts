import {
    prefillMyTemplateAltTextAction,
    prefillMyTemplateContentAction,
    prefillMyTemplateFaqAction,
    prefillMyTemplateMetaAction,
    uploadMyTemplateImageAction,
} from '@/app/api/_actions/expert-authoring.actions'
import type { TemplateAuthoringActions } from '@/components/templates/authoring/actions-context'

export function expertAuthoringActions(templateId: string): TemplateAuthoringActions {
    return {
        uploadImage: formData => uploadMyTemplateImageAction(templateId, formData),
        prefillContent: brief => prefillMyTemplateContentAction(templateId, brief),
        prefillMeta: brief => prefillMyTemplateMetaAction(templateId, brief),
        prefillFaq: input => prefillMyTemplateFaqAction(templateId, input),
        prefillAltText: input => prefillMyTemplateAltTextAction(templateId, input),
    }
}
