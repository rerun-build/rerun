import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AccountMenu } from '@/components/home/AccountMenu'
import { HOME_GUTTER } from '@/components/home/CoworkerRow'
import { InboxButton } from '@/components/home/InboxButton'
import { GlassButton } from '@/components/ui/GlassButton'
import { spacing } from '@/theme/tokens'

type HomeHeaderProps = {
    inboxCount: number
    onInbox: () => void
    onNewCoworker: () => void
}

export function HomeHeader({ inboxCount, onInbox, onNewCoworker }: HomeHeaderProps) {
    const t = useTranslations('mobileHome')
    return (
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: HOME_GUTTER }}>
            <AccountMenu />

            <View style={{ flex: 1 }} />

            <InboxButton count={inboxCount} onPress={onInbox} />
            <GlassButton symbol="plus" label={t('newCoworker')} onPress={onNewCoworker} />
        </View>
    )
}
