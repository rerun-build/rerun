import { StyleSheet, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing, withAlpha } from '@/theme/tokens'

export type StartedBy = { agentId: string | null; name: string }

// The web's header over a conversation another coworker opened (AgentSheetChat): who started it,
// so the first message does not read as the person's own.
export function StartedByBanner({ startedBy }: { startedBy: StartedBy }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.origins')
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: theme.border, backgroundColor: withAlpha(theme.muted, 0.5) }}>
            {startedBy.agentId && <AgentBuddy agentId={startedBy.agentId} size={20} mood="idle" animated={false} facing="right" />}
            <AppText variant="footnote" tone="muted" style={{ flex: 1 }}>
                {t.rich('startedBy', {
                    name: startedBy.name,
                    strong: chunks => (
                        <AppText variant="footnote" style={{ fontFamily: fonts.medium }}>
                            {chunks}
                        </AppText>
                    ),
                })}
            </AppText>
        </View>
    )
}
