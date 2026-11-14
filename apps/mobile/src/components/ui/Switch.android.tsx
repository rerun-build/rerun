import { Switch as NativeSwitch, type SwitchProps } from 'react-native'

import { TONES } from '@/components/ui/Badge'
import { useTheme } from '@/theme/theme'

const THUMB = '#ffffff'

export function Switch({ trackColor, ...props }: SwitchProps) {
    const theme = useTheme()
    return <NativeSwitch trackColor={{ false: trackColor?.false ?? theme.input, true: trackColor?.true ?? TONES.green[theme.scheme] }} thumbColor={THUMB} {...props} />
}
