'use client'

import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { createContext, useContext, type ReactNode } from 'react'

const BrandContext = createContext<Brand>(RERUN_BRAND)

export function BrandProvider({ brand, children }: { brand: Brand; children: ReactNode }) {
    return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}

export function useBrand(): Brand {
    return useContext(BrandContext)
}
