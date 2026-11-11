import { Image } from 'expo-image'
import { useState } from 'react'
import { Pressable } from 'react-native'
import { useTranslations } from 'use-intl'

import { fileHeadersFor } from '@/api/files'
import { useAuth } from '@/auth/AuthProvider'
import { Icon } from '@/components/ui/Icon'
import { openViewer } from '@/components/viewer/viewer-store'
import { useTheme } from '@/theme/theme'

const MAX_HEIGHT = 360

// An image of an answer at its own proportions, as wide as the thread allows and never taller than a
// screenful. A file on the Box goes through the hub with the same headers as every other call.
export function MarkdownImage({ url, alt }: { url: string | null; alt: string }) {
    const theme = useTheme()
    const { session, me } = useAuth()
    const [size, setSize] = useState<{ width: number; height: number } | null>(null)
    const [broken, setBroken] = useState(false)
    const t = useTranslations('mobileChat.markdown')
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const aspectRatio = size ? size.width / size.height : 4 / 3
    return (
        <Pressable
            disabled={!url || broken}
            onPress={() => url && openViewer([{ url, name: alt || url.split(/[?#]/)[0].split('/').at(-1) || t('image'), image: true }])}
            accessibilityRole="imagebutton"
            accessibilityLabel={alt || t('image')}
            style={{ alignSelf: 'flex-start', width: '100%', maxWidth: size?.width, aspectRatio, maxHeight: MAX_HEIGHT, borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: theme.muted, alignItems: 'center', justifyContent: 'center' }}
        >
            {url && !broken ? (
                <Image
                    source={{ uri: url, headers: fileHeadersFor(caller, url) }}
                    contentFit="contain"
                    transition={150}
                    onLoad={event => setSize({ width: event.source.width, height: event.source.height })}
                    onError={() => setBroken(true)}
                    style={{ width: '100%', height: '100%' }}
                />
            ) : (
                <Icon name="image" size={18} color={theme.mutedForeground} />
            )}
        </Pressable>
    )
}
