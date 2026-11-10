'use client'

import { LastUsedBadge } from '@/components/auth/LastUsedBadge'
import { Button } from '@/components/ui/button'
import { useLastSignInMethod, type LastSignInMethod } from '@/lib/auth/last-sign-in'
import { OAUTH_PROVIDER_CONFIG, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { startOAuthSignIn } from '@/lib/auth/oauth-sign-in'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { useInAppBrowser } from '@/lib/use-in-app-browser'
import { track } from '@rerun/analytics/client'
import { useTranslations } from 'next-intl'

// Where the provider refuses an in-app browser the button is not drawn at all, and the other ways in
// are what is left.
export function OAuthSignInButton({
    provider,
    verb,
    linkAnonymous = false,
    onLeave,
    lastUsed,
}: {
    provider: OAuthProvider
    verb: 'Sign in with' | 'Continue with'
    linkAnonymous?: boolean
    onLeave?: () => void
    // Forced by the lab; read from this browser everywhere else.
    lastUsed?: LastSignInMethod | null
}) {
    const t = useTranslations('auth.oauth')
    const inAppBrowser = useInAppBrowser()
    const remembered = useLastSignInMethod()
    const usedLast = (lastUsed === undefined ? remembered : lastUsed) === provider
    const { label, refusedInAppBrowser } = OAUTH_PROVIDER_CONFIG[provider]
    if (inAppBrowser && refusedInAppBrowser) return null

    const onClick = async () => {
        track('signup_method_selected', { method: provider })
        onLeave?.()
        await startOAuthSignIn(provider, { linkAnonymous })
    }

    return (
        <Button variant="outline" className="w-full gap-2" onClick={onClick}>
            <ProviderIcon provider={provider} className="size-4" />
            <span>{verb === 'Sign in with' ? t('signInWith', { provider: label }) : t('continueWith', { provider: label })}</span>
            {usedLast && <LastUsedBadge />}
        </Button>
    )
}
