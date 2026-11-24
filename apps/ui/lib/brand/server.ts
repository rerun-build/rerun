import 'server-only'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { cache } from 'react'

// The brand of the request, read once per render.
export const getBrand = cache(async (): Promise<Brand> => RERUN_BRAND)
