import { FORMER_MEMBER, type AuthorProfile } from '@rerun/contracts'
import { Image } from 'expo-image'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Skeleton } from '@/components/ui/Skeleton'
import { useTheme } from '@/theme/theme'
import { brand, fonts, radius, spacing, withAlpha } from '@/theme/tokens'

const SIZE = 28
const NAMED_FOR_MS = 1800

// The web's `CardAvatar` tints: the initials sit on one of five, hashed from the name.
const TINTS = [brand.base, '#0891b2', '#16a34a', '#ea580c', '#db2777']

const firstNameOf = (author: AuthorProfile) => (author.id === FORMER_MEMBER.id ? author.name : author.name.split(' ')[0])

function initialsOf(name: string): string {
    return name
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase())
        .join('')
}

function tintOf(name: string): string {
    let hash = 0
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return TINTS[Math.abs(hash) % TINTS.length]
}

export function AuthorAvatar({ author, size = SIZE }: { author: AuthorProfile; size?: number }) {
    const [broken, setBroken] = useState(false)
    if (author.photo && !broken) return <Image source={{ uri: author.photo }} contentFit="cover" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: size / 2 }} />
    const tint = tintOf(author.name)
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(tint, 0.15) }}>
            <AppText style={{ fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, color: tint }}>{initialsOf(author.name)}</AppText>
        </View>
    )
}

/**
 * The web's `AuthoredGroup`: consecutive messages one person sent, signed once by their avatar at the
 * foot of the group. A `null` author is one not resolved yet: the avatar's place is held so the
 * bubbles never shift. A long press on the avatar names them, the web's hover tooltip.
 */
export function AuthoredGroup({ author, children }: { author: AuthorProfile | null; children: ReactNode }) {
    const theme = useTheme()
    const [named, setNamed] = useState(false)
    const t = useTranslations('mobileChat.messages')
    useEffect(() => {
        if (!named) return
        const timer = setTimeout(() => setNamed(false), NAMED_FOR_MS)
        return () => clearTimeout(timer)
    }, [named])

    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}>{children}</View>
            {author ? (
                <Pressable onLongPress={() => setNamed(true)} delayLongPress={250} accessibilityRole="image" accessibilityLabel={t('sentBy', { name: author.name })}>
                    {named && (
                        <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)} pointerEvents="none" style={{ position: 'absolute', bottom: SIZE + 6, right: 0, width: 200, alignItems: 'flex-end' }}>
                            <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: theme.foreground }}>
                                <AppText variant="caption" numberOfLines={1} style={{ color: theme.background }}>
                                    {firstNameOf(author)}
                                </AppText>
                            </View>
                        </Animated.View>
                    )}
                    <AuthorAvatar author={author} />
                </Pressable>
            ) : (
                <Skeleton style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2 }} />
            )}
        </View>
    )
}
