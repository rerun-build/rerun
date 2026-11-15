import { Button, Host } from '@expo/ui/swift-ui'
import { buttonStyle, controlSize, lineLimit } from '@expo/ui/swift-ui/modifiers'
import { ScrollView } from 'react-native'

import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

export function Suggestions({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
    const theme = useTheme()
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ overflow: 'visible' }} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
            {items.map(item => (
                <Host key={item} matchContents colorScheme={theme.scheme}>
                    <Button label={item} onPress={() => onPick(item)} modifiers={[buttonStyle('glass'), controlSize('regular'), lineLimit(1)]} />
                </Host>
            ))}
        </ScrollView>
    )
}
