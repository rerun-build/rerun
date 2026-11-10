import { Section, Toggle } from '@expo/ui/swift-ui'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AccountMenu } from '@/components/home/AccountMenu'
import type { GroupMode } from '@/components/home/useGroupMode'
import { CircleTrigger, NativeMenu } from '@/components/ui/NativeMenu'
import { spacing } from '@/theme/tokens'

type HomeHeaderProps = {
    group: GroupMode
    onGroup: (group: GroupMode) => void
}

export function HomeHeader({ group, onGroup }: HomeHeaderProps) {
    const t = useTranslations('mobileHome')
    return (
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg }}>
            <AccountMenu />

            <View style={{ flex: 1 }} />

            <NativeMenu glass="circle" label={t('header.view')} trigger={<CircleTrigger symbol="line.3.horizontal.decrease" />}>
                <Section title={t('header.view')}>
                    <Toggle label={t('header.recent')} isOn={group === 'recent'} onIsOnChange={() => onGroup('recent')} />
                    <Toggle label={t('header.byBox')} isOn={group === 'box'} onIsOnChange={() => onGroup('box')} />
                </Section>
            </NativeMenu>
        </View>
    )
}
