import { Host, Image } from '@expo/ui/swift-ui'

import { useTheme } from '@/theme/theme'

// Sign in with Apple shows Apple's own logo, never an icon set's apple: the system draws it.
export function AppleLogo({ size = 17 }: { size?: number }) {
    const theme = useTheme()
    return (
        <Host matchContents colorScheme={theme.scheme}>
            <Image systemName="apple.logo" size={size} color={theme.foreground} />
        </Host>
    )
}
