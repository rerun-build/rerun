'use client'

import type { OnboardingAnswers } from '@/app/actions/onboarding'
import type { ViewerSignals } from '@/lib/templates/library-view'
import { workTypeTemplateCategory } from '@/lib/onboarding/work-types'
import { useSession } from '@/supabase/session/SessionProvider'
import { useMemo } from 'react'

export function useLibraryViewerSignals(): Required<ViewerSignals> {
    const { workspaceAnswers } = useSession()
    return useMemo(() => {
        const answers = workspaceAnswers as OnboardingAnswers | null
        return {
            category: answers?.industry ?? workTypeTemplateCategory(answers?.work_type) ?? answers?.sector ?? null,
            connectorSlugs: answers?.skipped ? [] : (answers?.tools ?? []),
        }
    }, [workspaceAnswers])
}
