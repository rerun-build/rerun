import MaskedViewNative from '@react-native-masked-view/masked-view'
import type { ComponentType, ReactElement } from 'react'
import type { ViewProps } from 'react-native'

// The package types its class through React Native's NativeMethods mixin, which the strict types of
// React Native 0.88 no longer export: the component itself is unchanged.
export const MaskedView = MaskedViewNative as unknown as ComponentType<ViewProps & { maskElement: ReactElement }>
