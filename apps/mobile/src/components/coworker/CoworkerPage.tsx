import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { SheetHeader } from '@/components/providers/bits'
import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// A page pushed from the coworker's details, full screen under the status bar.
export function CoworkerPage({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    return (
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={{ paddingTop: insets.top + spacing.xs, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xl }}>
            <SheetHeader title={title} onBack={onBack} />
            {children}
        </ScrollView>
    )
}

export function LoadFailed() {
    const t = useTranslations('mobileCoworker.page')
    return (
        <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl }}>
            <AppText variant="footnote" tone="muted" style={{ textAlign: 'center' }}>
                {t('loadFailed')}
            </AppText>
        </View>
    )
}
