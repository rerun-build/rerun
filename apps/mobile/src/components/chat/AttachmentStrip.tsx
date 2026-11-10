import { Image } from 'expo-image'
import { SymbolView } from 'expo-symbols'
import { Pressable, ScrollView, View } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { isImage, type ComposerAttachment } from './attachments'

const THUMB = 56
const FILE_WIDTH = 168
const REMOVE = 22

export function AttachmentStrip({ attachments, onRemove }: { attachments: ComposerAttachment[]; onRemove: (uri: string) => void }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.composer')
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.xs, paddingRight: spacing.xs }}>
            {attachments.map(attachment => (
                <Animated.View key={attachment.uri} entering={FadeIn} exiting={FadeOut} layout={LinearTransition}>
                    {isImage(attachment) ? (
                        <Image source={{ uri: attachment.uri }} contentFit="cover" accessibilityLabel={attachment.name} style={{ width: THUMB, height: THUMB, borderRadius: radius.md, backgroundColor: theme.muted }} />
                    ) : (
                        <View accessibilityLabel={attachment.name} style={{ height: THUMB, maxWidth: FILE_WIDTH, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: theme.muted }}>
                            <SymbolView name="doc" size={20} weight="regular" tintColor={theme.mutedForeground} />
                            <AppText variant="footnote" numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 1 }}>
                                {attachment.name}
                            </AppText>
                        </View>
                    )}
                    <Pressable onPress={() => onRemove(attachment.uri)} accessibilityRole="button" accessibilityLabel={t('removeAttachment', { name: attachment.name })} hitSlop={10} style={{ position: 'absolute', top: -spacing.xs, right: -spacing.xs }}>
                        <View style={{ width: REMOVE, height: REMOVE, borderRadius: REMOVE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary, borderWidth: 2, borderColor: theme.card }}>
                            <SymbolView name="xmark" size={9} weight="bold" tintColor={theme.primaryForeground} />
                        </View>
                    </Pressable>
                </Animated.View>
            ))}
        </ScrollView>
    )
}
