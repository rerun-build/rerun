import { Host, Picker, Text } from '@expo/ui/swift-ui'
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'

import type { SegmentedControlProps } from '@/components/ui/segmented-types'
import { useTheme } from '@/theme/theme'

// The system's segmented picker, stretched to its container.
export function SegmentedControl<Value extends string>({ options, value, onChange }: SegmentedControlProps<Value>) {
    const theme = useTheme()
    return (
        <Host matchContents={{ vertical: true }} colorScheme={theme.scheme} style={{ alignSelf: 'stretch' }}>
            <Picker selection={value} onSelectionChange={selection => onChange(selection as Value)} modifiers={[pickerStyle('segmented')]}>
                {options.map(option => (
                    <Text key={option.value} modifiers={[tag(option.value)]}>
                        {option.label}
                    </Text>
                ))}
            </Picker>
        </Host>
    )
}
