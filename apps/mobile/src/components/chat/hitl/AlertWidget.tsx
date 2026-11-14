import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { usePaneSize } from '@/components/layout/PaneSize'
import { AppText } from '@/components/ui/AppText'

import { Markdown } from '../Markdown'
import { HitlAction, HitlCard } from './HitlCard'

export function AlertWidget({ message, onAcknowledge }: { message: string; onAcknowledge: () => Promise<void> }) {
    const t = useTranslations('mobileHitl.alert')
    const { height } = usePaneSize()
    const [pending, setPending] = useState(false)
    const [failed, setFailed] = useState(false)
    const acknowledge = async () => {
        setPending(true)
        setFailed(false)
        try {
            await onAcknowledge()
        } catch {
            setFailed(true)
            setPending(false)
        }
    }
    return (
        <HitlCard symbol="bell" label={t('label')}>
            <ScrollView nestedScrollEnabled style={{ maxHeight: height * 0.22 }}>
                <Markdown text={message} />
            </ScrollView>
            {failed && (
                <AppText variant="footnote" tone="destructive">
                    {t('failed')}
                </AppText>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <HitlAction label={pending ? t('marking') : t('markAsRead')} primary disabled={pending} onPress={acknowledge} />
            </View>
        </HitlCard>
    )
}
