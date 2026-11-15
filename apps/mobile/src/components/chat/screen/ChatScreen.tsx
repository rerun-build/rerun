import { View, type LayoutChangeEvent } from 'react-native'
import { WebView } from 'react-native-webview'

import { environment } from '@/config/environment'

import { ScreenCard } from './ScreenCard'
import { ScreenFace } from './ScreenFace'
import type { AgentScreen } from './useAgentScreen'
import type { TakeoverRequestState } from './useTakeoverRequest'

type ChatScreenProps = Pick<AgentScreen, 'status' | 'uri' | 'onMessage'> & {
    attachWebView: AgentScreen['attachWebView']
    site: string | null
    takeover?: TakeoverRequestState
    onTakeControl: () => void
    onLayout?: (event: LayoutChangeEvent) => void
}

export function ChatScreen({ status, uri, onMessage, attachWebView, site, takeover, onTakeControl, onLayout }: ChatScreenProps) {
    const live = status === 'live'
    return (
        <ScreenCard
            live={live}
            site={site}
            takeover={takeover}
            onTakeControl={onTakeControl}
            onLayout={onLayout}
            screen={
                <>
                    {uri && (
                        <View pointerEvents="none" style={{ flex: 1, opacity: live ? 1 : 0 }}>
                            <WebView ref={attachWebView} source={{ uri }} onMessage={onMessage} style={{ flex: 1, backgroundColor: 'transparent' }} bounces={false} scrollEnabled={false} originWhitelist={[environment.apiUrl]} />
                        </View>
                    )}
                    <ScreenFace status={status} />
                </>
            }
        />
    )
}
