'use client'

import { industryFromAnswers } from '@/lib/onboarding/box-name'
import { useSession } from '@/supabase/session/SessionProvider'
import { useMemo } from 'react'

export function useOnboardingIndustry(): string | null {
    const { workspaceAnswers: answers } = useSession()

    return useMemo(() => industryFromAnswers(answers), [answers])
}
