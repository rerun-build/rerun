import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'

// Below the viewer's close button, title and counter.
const HEADER_ROOM = 64

// A file that is not a photo, read in a web view from its copy in the cache: iOS draws PDFs, text,
// spreadsheets and office documents there. What it cannot draw says so, the share sheet stays a tap away.
export function FilePage({ url, name, load }: { url: string; name: string; load: () => Promise<string> }) {
    const t = useTranslations('mobileCommon')
    const { width, height } = useWindowDimensions()
    const insets = useSafeAreaInsets()
    const [uri, setUri] = useState<string | null>(null)
    const [failed, setFailed] = useState(false)
    // Downloaded once per file: the loader is rebuilt on every render of the viewer.
    const loadRef = useRef(load)
    useEffect(() => {
        loadRef.current = load
    })

    useEffect(() => {
        let alive = true
        loadRef
            .current()
            .then(local => alive && setUri(local))
            .catch(() => alive && setFailed(true))
        return () => {
            alive = false
        }
    }, [url])

    if (failed) {
        return (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 }}>
                <Icon name="file" size={28} color="#a1a1a1" />
                <AppText variant="callout" numberOfLines={2} style={{ color: '#ffffff', textAlign: 'center' }}>
                    {name}
                </AppText>
                <AppText variant="footnote" style={{ color: '#a1a1a1', textAlign: 'center' }}>
                    {t('viewer.noPreview')}
                </AppText>
            </View>
        )
    }
    if (!uri) {
        return (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#ffffff" />
            </View>
        )
    }
    const folder = uri.slice(0, uri.lastIndexOf('/') + 1)
    return (
        <View style={{ width, height, paddingTop: insets.top + HEADER_ROOM, paddingBottom: insets.bottom }}>
            <WebView source={{ uri }} originWhitelist={['*']} allowingReadAccessToURL={folder} allowFileAccess style={{ flex: 1, backgroundColor: '#ffffff' }} onError={() => setFailed(true)} />
        </View>
    )
}
