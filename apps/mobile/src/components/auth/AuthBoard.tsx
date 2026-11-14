import { View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { environment } from '@/config/environment'
import { useTheme } from '@/theme/theme'

const FADE_IN_MS = 700

export function AuthBoard({ height }: { height: number }) {
    const theme = useTheme()
    const opacity = useSharedValue(0)
    const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }))

    const onMessage = (event: WebViewMessageEvent) => {
        const { type } = JSON.parse(event.nativeEvent.data) as { type: string }
        if (type === 'ready') opacity.set(withTiming(1, { duration: FADE_IN_MS }))
    }

    return (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height }}>
            <Animated.View style={[{ flex: 1 }, fade]}>
                <WebView
                    source={{ uri: `${environment.apiUrl}/render/app-auth?theme=${theme.scheme}` }}
                    onLoadStart={() => opacity.set(0)}
                    onMessage={onMessage}
                    scrollEnabled={false}
                    bounces={false}
                    showsVerticalScrollIndicator={false}
                    showsHorizontalScrollIndicator={false}
                    style={{ flex: 1, backgroundColor: theme.background }}
                />
            </Animated.View>
        </View>
    )
}
