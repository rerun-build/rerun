import { Keyframe } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { GlassButton } from '@/components/ui/GlassButton'

const SIZE = 40

export const RISE_IN = new Keyframe({ 0: { transform: [{ translateY: 12 }, { scale: 0.85 }] }, 100: { transform: [{ translateY: 0 }, { scale: 1 }] } }).duration(200)
export const SINK_OUT = new Keyframe({ 0: { transform: [{ translateY: 0 }, { scale: 1 }] }, 100: { transform: [{ translateY: 12 }, { scale: 0 }] } }).duration(180)

export function ScrollToEndButton({ onPress }: { onPress: () => void }) {
    const t = useTranslations('mobileChat.messages')
    return <GlassButton symbol="arrow-down" label={t('scrollToLatest')} size={SIZE} onPress={onPress} />
}
