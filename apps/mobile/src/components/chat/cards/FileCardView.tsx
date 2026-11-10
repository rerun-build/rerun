import type { FileCard } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'
import { Pressable, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { rawFileUrl } from '@/api/files'
import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { isImageItem, openViewer, type ViewerItem } from '@/components/viewer/viewer-store'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { AuthedImage, CardFrame } from './CardParts'
import { sizeParts } from './cards'

const MAX_ALBUM_TILES = 4
const NATURAL_MAX_HEIGHT = 288

// The web's `MediaAlbum`: one photo at its own size, more in a two-column grid of at most four tiles,
// the last one saying how many are left.
function Album({ items }: { items: ViewerItem[] }) {
    const t = useTranslations('mobileCards.file')
    const theme = useTheme()
    if (items.length === 1) {
        return (
            <Pressable onPress={() => openViewer(items, 0)} accessibilityRole="imagebutton" accessibilityLabel={t('open', { name: items[0].name })}>
                <AuthedImage url={items[0].url} style={{ width: '100%', height: NATURAL_MAX_HEIGHT, borderRadius: 16 }} />
            </Pressable>
        )
    }
    const tiles = items.slice(0, MAX_ALBUM_TILES)
    const hidden = items.length - tiles.length
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {tiles.map((item, index) => (
                <Pressable key={item.url} onPress={() => openViewer(items, index)} accessibilityRole="imagebutton" accessibilityLabel={t('open', { name: item.name })} style={{ width: '49%', aspectRatio: 1 }}>
                    <AuthedImage url={item.url} style={{ width: '100%', height: '100%', borderRadius: 16 }} />
                    {hidden > 0 && index === tiles.length - 1 && (
                        <View style={{ position: 'absolute', inset: 0, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                            <AppText variant="title" style={{ color: theme.scheme === 'dark' ? theme.foreground : '#ffffff' }}>{`+${hidden}`}</AppText>
                        </View>
                    )}
                </Pressable>
            ))}
        </View>
    )
}

// The files a coworker hands over: photos as an album, anything else as a list. A tap opens the
// full-screen viewer, which pages through the card and shares a file on.
export function useFileSize(): (size: number) => string {
    const t = useTranslations('mobileCards.file')
    const locale = useLocale()
    return size => {
        const { unit, value, fractionDigits } = sizeParts(size)
        return t(`size.${unit}`, { value: formatNumber(value, locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }) })
    }
}

export function FileCardView({ card, agentId }: { card: FileCard; agentId: string }) {
    const t = useTranslations('mobileCards.file')
    const fileSize = useFileSize()
    const theme = useTheme()
    const items: ViewerItem[] = card.files.map(file => ({ url: rawFileUrl({ agentId, path: file.path, scope: file.scope }), name: file.name }))
    if (items.every(isImageItem)) return <Album items={items} />

    return (
        <CardFrame symbol="copy" title={t('title', { count: card.files.length })}>
            {card.files.map((file, index) => (
                <Pressable key={`${file.scope}:${file.path}`} onPress={() => openViewer(items, index)} accessibilityRole="button" accessibilityLabel={t('open', { name: file.name })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: theme.border, backgroundColor: pressed ? theme.muted : 'transparent' })}>
                    {isImageItem(items[index]) ? (
                        <AuthedImage url={items[index].url} style={{ width: 40, height: 40, borderRadius: radius.sm }} />
                    ) : (
                        <View style={{ width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                            <Icon name="file-text" size={16} color={theme.mutedForeground} />
                        </View>
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="callout" medium numberOfLines={1}>
                            {file.name}
                        </AppText>
                        <AppText variant="caption" tone="muted">
                            {fileSize(file.size)}
                        </AppText>
                    </View>
                    <Icon name="chevron-right" size={12} bold color={theme.mutedForeground} />
                </Pressable>
            ))}
        </CardFrame>
    )
}
