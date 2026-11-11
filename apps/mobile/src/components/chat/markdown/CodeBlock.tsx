import * as Clipboard from 'expo-clipboard'
import { Highlight, themes } from 'prism-react-renderer'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { HorizontalScroll } from '@/components/chat/HorizontalScroll'
import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import * as Haptics from '@/lib/haptics'
import { useTheme } from '@/theme/theme'
import { fonts, spacing, withAlpha } from '@/theme/tokens'

const COPIED_FOR_MS = 2000

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.markdown')
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS)
        return () => clearTimeout(timer)
    }, [copied])
    return (
        <Pressable
            disabled={disabled}
            onPress={() => {
                Clipboard.setStringAsync(text)
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                setCopied(true)
            }}
            accessibilityRole="button"
            accessibilityLabel={t('copy')}
            hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, height: 28, opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}
        >
            <Icon name={copied ? 'check' : 'copy'} size={13} color={copied ? '#10b981' : theme.mutedForeground} />
            <AppText variant="caption" tone="muted">
                {copied ? t('copied') : t('copy')}
            </AppText>
        </Pressable>
    )
}

// The web's code block in a chat answer (Streamdown, framed by globals.css): a header naming the
// language over a body on the page colour, both inside the muted frame of the answer's bubbles.
function Frame({ label, copyText, incomplete, children }: { label: string; copyText: string; incomplete?: boolean; children: React.ReactNode }) {
    const theme = useTheme()
    return (
        <View style={{ alignSelf: 'stretch', borderRadius: 20, borderCurve: 'continuous', backgroundColor: theme.muted, padding: 6, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.sm }}>
                <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {label}
                </AppText>
                <CopyButton text={copyText} disabled={incomplete} />
            </View>
            <View style={{ borderRadius: 14, borderCurve: 'continuous', backgroundColor: theme.background, overflow: 'hidden' }}>{children}</View>
        </View>
    )
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.markdown')
    const text = code.replace(/\n+$/, '')
    const prismTheme = theme.scheme === 'dark' ? themes.vsDark : themes.github
    return (
        <Frame label={language || t('code')} copyText={text}>
            <HorizontalScroll contentContainerStyle={{ padding: spacing.md }}>
                <Highlight theme={prismTheme} code={text} language={language.toLowerCase()}>
                    {({ tokens, getTokenProps }) => (
                        <Text selectable style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 20, color: theme.foreground }}>
                            {tokens.map((line, i) => (
                                <Text key={i}>
                                    {line.map((token, key) => {
                                        if (token.empty) return null
                                        const { children, style } = getTokenProps({ token })
                                        return (
                                            <Text key={key} style={{ color: style?.color, fontStyle: style?.fontStyle === 'italic' ? 'italic' : undefined }}>
                                                {children}
                                            </Text>
                                        )
                                    })}
                                    {i < tokens.length - 1 ? '\n' : null}
                                </Text>
                            ))}
                        </Text>
                    )}
                </Highlight>
            </HorizontalScroll>
        </Frame>
    )
}

/**
 * A ```draft fence: a text the user sends or pastes elsewhere (an email, a post, a message). It reads
 * as prose rather than code, and copies exactly as written. The fence's meta names it.
 */
export function DraftBlock({ code, title }: { code: string; title: string }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.markdown')
    const text = code.replace(/\n+$/, '')
    return (
        <Frame label={title || t('draft')} copyText={text}>
            <Text selectable style={{ padding: spacing.lg, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: theme.foreground }}>
                {text}
            </Text>
        </Frame>
    )
}

export function inlineCodeBackground(theme: ReturnType<typeof useTheme>, surface: 'page' | 'bubble' | 'brand'): string {
    if (surface === 'brand') return 'rgba(255,255,255,0.15)'
    if (surface === 'bubble') return withAlpha(theme.background, 0.7)
    return theme.muted
}

