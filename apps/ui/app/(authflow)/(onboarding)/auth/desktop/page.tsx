import { isPkceChallenge } from '@/app/api/_services/desktop-auth.service'
import { OnboardingDialog, OnboardingHeading } from '@/components/onboarding/OnboardingDialog'
import { createClient } from '@/supabase/server'
import { isDesktopShellChannel, type DesktopSignInProvider } from '@rerun/contracts'
import { getTranslations } from 'next-intl/server'
import { DesktopHandoff } from './DesktopHandoff'

const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

type Params = { challenge?: string; state?: string; channel?: string; provider?: string }

// Opened in the system browser by the desktop app (`auth.startBrowserSignIn`). Signed in here, the
// person confirms which account the app gets; signed out, they sign in first and come back.
export default async function DesktopAuthPage({ searchParams }: { searchParams: Promise<Params> }) {
    const { challenge, state, channel, provider } = await searchParams
    const t = await getTranslations('desktopShell.handoff')
    if (!isPkceChallenge(challenge) || !state || !STATE_PATTERN.test(state) || !isDesktopShellChannel(channel)) {
        return (
            <OnboardingDialog stepKey="invalid">
                <OnboardingHeading title={t('invalidTitle')} subtitle={t('invalidBody')} />
            </OnboardingDialog>
        )
    }
    const { data } = await (await createClient()).auth.getUser()
    const user = data.user && !data.user.is_anonymous ? data.user : null
    const signInProvider: DesktopSignInProvider | null = provider === 'google' || provider === 'apple' ? provider : null
    return <DesktopHandoff challenge={challenge} state={state} channel={channel} provider={signInProvider} account={user ? (user.email ?? user.phone ?? '') : null} />
}
