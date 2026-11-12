import * as Application from 'expo-application'

import { mockStorefront } from './mock-storefront'
import { nativeStorefront } from './native-storefront'
import type { Storefront } from './types'

export type { StoreProduct, StoreTransaction, Storefront } from './types'

// `EXPO_PUBLIC_STORE=mock` swaps the store for one that sells without a store: a development run
// against the local hub, the labs and Maestro. A store build never sets it.
export const storefront: Storefront = process.env.EXPO_PUBLIC_STORE === 'mock' ? mockStorefront(Application.applicationId ?? 'build.rerun.app') : nativeStorefront
