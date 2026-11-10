import type { ClientPlatform } from '@rerun/contracts'
import { Platform } from 'react-native'

export const clientPlatform: ClientPlatform = Platform.OS === 'android' ? 'android' : 'ios'
