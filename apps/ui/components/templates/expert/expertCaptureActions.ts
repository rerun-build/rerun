import { captureMyAgentsAction, listMyCaptureSourcesAction, planMyCaptureAction } from '@/app/api/_actions/expert-capture.actions'
import type { CaptureActions } from '@/components/templates/capture/types'

export function expertCaptureActions(templateId: string): CaptureActions {
    return {
        listSources: listMyCaptureSourcesAction,
        plan: input => planMyCaptureAction({ templateId, ...input }),
        capture: input => captureMyAgentsAction({ templateId, ...input }),
    }
}
