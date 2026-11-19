import { View } from 'react-native'

import { Button } from '@/components/ui/Button'
import { openInAppBrowser } from '@/lib/in-app-browser'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

const PAGE = 'https://docs.rerun.build'
const EXCERPT = 'Done. I set up the routine and wrote down how it works in docs.rerun.build, with the steps to change it.'

// Dev only: Rerun's own browser, opened from a message or alone.
export default function BrowserLab() {
    const theme = useTheme()
    return (
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: theme.background }}>
            <Button label="From a message" onPress={() => openInAppBrowser({ url: PAGE, excerpt: EXCERPT })} />
            <Button label="Page only" variant="secondary" onPress={() => openInAppBrowser({ url: PAGE })} />
        </View>
    )
}
