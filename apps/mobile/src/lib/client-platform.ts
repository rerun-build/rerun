import type { ClientPlatform } from '@moldwright/contracts'
import { Platform } from 'react-native'

export const clientPlatform: ClientPlatform = Platform.OS === 'android' ? 'android' : 'ios'
