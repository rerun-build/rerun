import { View } from 'react-native'

import { Button } from '@/components/ui/Button'
import { openInAppBrowser, type LinkOrigin } from '@/lib/in-app-browser'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

const LIGHT_PAGE = 'https://docs.rerun.build'
const DARK_PAGE = 'https://rerun.build/blog'
const FROM: LinkOrigin = {
    author: { id: 'agent-scout', kind: 'coworker', name: 'Sales', role: 'Follows up with leads' },
    excerpt: 'Done. I drafted the follow-up in docs.rerun.build and moved the deal to Negotiation.',
}

// Dev only: Rerun's own browser over a light page and a dark one, opened from a message or alone.
export default function BrowserLab() {
    const theme = useTheme()
    return (
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: theme.background }}>
            <Button label="Light page, from a message" onPress={() => openInAppBrowser({ url: LIGHT_PAGE, from: FROM })} />
            <Button label="Dark page, from a message" onPress={() => openInAppBrowser({ url: DARK_PAGE, from: FROM })} />
            <Button label="Page only" variant="secondary" onPress={() => openInAppBrowser({ url: LIGHT_PAGE })} />
        </View>
    )
}
