import { Host, Image } from '@expo/ui/swift-ui'

import { useTheme } from '@/theme/theme'

export function AppleLogo({ size = 17 }: { size?: number }) {
    const theme = useTheme()
    return (
        <Host matchContents colorScheme={theme.scheme}>
            <Image systemName="apple.logo" size={size} color={theme.foreground} />
        </Host>
    )
}
