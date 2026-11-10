import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { fieldOutline } from '@/theme/field'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing } from '@/theme/tokens'

import { HitlAction } from './HitlCard'

// The step a refusal goes through so the coworker learns why, not only that the user said no. The
// web's form, drawn in place of the card's actions.
export function DeclineReasonForm({ note, onNoteChange, onBack, onConfirm, placeholder }: { note: string; onNoteChange: (note: string) => void; onBack: () => void; onConfirm: () => void; placeholder?: string }) {
    const t = useTranslations('mobileHitl')
    const theme = useTheme()
    const [focused, setFocused] = useState(false)
    return (
        <View style={{ gap: spacing.sm }}>
            <TextInput value={note} onChangeText={onNoteChange} autoFocus multiline placeholder={placeholder ?? t('decline.placeholder')} placeholderTextColor={theme.mutedForeground} accessibilityLabel={t('decline.reason')} testID="hitl-decline-reason" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={{ minHeight: 72, maxHeight: 160, padding: spacing.md, textAlignVertical: 'top', borderRadius: radius.md, borderCurve: 'continuous', ...fieldOutline(theme, { focused }), backgroundColor: theme.background, color: theme.foreground, fontFamily: fonts.regular, fontSize: 16 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm }}>
                <HitlAction label={t('actions.back')} onPress={onBack} />
                <HitlAction label={t('actions.confirm')} tone="destructive" onPress={onConfirm} />
            </View>
        </View>
    )
}
