import { Button, Host, RNHostView } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonBorderShape, buttonStyle, disabled as disabledModifier } from '@expo/ui/swift-ui/modifiers'
import { createContext, use } from 'react'
import { View } from 'react-native'

import { Icon, type IconName } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'

export const GLASS_BUTTON_SIZE = 44
// What `.buttonStyle(.glass)` pads around its label, on each side: a label framed `size - 2 × inset` gives a button of `size`.
export const GLASS_INSET = 7

// Glass does not render under a parent faded below full opacity: a layer that fades in and out
// switches it off while hidden and lets it come back natively.
export const GlassShown = createContext(true)

export function useGlassStyle() {
    const shown = use(GlassShown)
    return { style: shown ? 'regular' : 'none', animate: true, animationDuration: 0.25 } as const
}

type GlassButtonProps = {
    symbol: IconName
    label: string
    onPress: () => void
    disabled?: boolean
    size?: number
    // Forces the glass's scheme over a backdrop that ignores the theme, like the black of the viewer.
    scheme?: 'light' | 'dark'
}

// The system's own glass button (SwiftUI `.buttonStyle(.glass)`), round, around the app's `Icon`.
export function GlassButton({ symbol, label, onPress, disabled = false, size = GLASS_BUTTON_SIZE, scheme }: GlassButtonProps) {
    const theme = useTheme()
    const colorScheme = scheme ?? theme.scheme
    return (
        <Host matchContents colorScheme={colorScheme}>
            <Button onPress={onPress} modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), disabledModifier(disabled), accessibilityLabel(label)]}>
                <RNHostView matchContents>
                    <View style={{ width: size - 2 * GLASS_INSET, height: size - 2 * GLASS_INSET, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={symbol} size={Math.round(size * 0.45)} color={colorScheme === 'dark' ? '#fafafa' : theme.foreground} />
                    </View>
                </RNHostView>
            </Button>
        </Host>
    )
}
