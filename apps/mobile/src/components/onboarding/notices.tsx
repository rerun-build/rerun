import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { webHost } from '@/config/environment'
import { spacing } from '@/theme/tokens'

function Notice({ thinking = false, title, body, children }: { thinking?: boolean; title: string; body: string; children?: ReactNode }) {
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl }}>
            <ForemanOrb size={64} state={thinking ? 'thinking' : 'idle'} />
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
                <AppText variant="title" style={{ textAlign: 'center' }}>
                    {title}
                </AppText>
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    {body}
                </AppText>
            </View>
            {children}
        </View>
    )
}

export type SetupState = 'starting' | 'failed' | 'blocked'

// Between the last question and the app: the workspace starts and its machine wakes up. The app sells
// nothing, so it only says something else when that did not go through.
export function SetupNotice({ state, onRetry }: { state: SetupState; onRetry: () => void }) {
    const t = useTranslations('mobileOnboarding.setup')
    return (
        <Notice thinking={state === 'starting'} title={t(`${state}.title`)} body={t(`${state}.body`, { host: webHost })}>
            {state === 'failed' && <Button label={t('tryAgain')} onPress={onRetry} />}
        </Notice>
    )
}

// No machine is free: the web's waitlist wall. Their answers are kept, and the screen opens on its own
// once a machine frees up.
export function WaitlistNotice() {
    const t = useTranslations('mobileOnboarding.waitlist')
    return <Notice title={t('title')} body={t('body')} />
}
