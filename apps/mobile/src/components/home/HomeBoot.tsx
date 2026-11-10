import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HomeSkeleton } from '@/components/home/HomeSkeleton'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// The native launch screen redrawn in React, skeleton rows at their exact place: the
// splash lab plays the cold start from it.
export function HomeBoot() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + spacing.sm + GLASS_BUTTON_SIZE + spacing.xl }}>
            <HomeSkeleton />
        </View>
    )
}
