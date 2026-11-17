import type { Metadata } from 'next'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { loadStarterTeams } from '@/lib/onboarding/board-teams.server'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('auth.page')
    return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
    return <OnboardingShell teams={await loadStarterTeams()}>{children}</OnboardingShell>
}
