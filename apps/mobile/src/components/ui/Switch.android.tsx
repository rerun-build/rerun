import { Switch as NativeSwitch, type SwitchProps } from 'react-native'

import { TONES } from '@/components/ui/Badge'
import { useTheme } from '@/theme/theme'

const THUMB = '#ffffff'

// The iOS switch on Android: a white thumb, the track the caller asks for, green once on otherwise. Left
// alone, Android paints the Material defaults, a teal thumb on a violet track.
export function Switch({ trackColor, ...props }: SwitchProps) {
    const theme = useTheme()
    return <NativeSwitch trackColor={{ false: trackColor?.false ?? theme.input, true: trackColor?.true ?? TONES.green[theme.scheme] }} thumbColor={THUMB} {...props} />
}
