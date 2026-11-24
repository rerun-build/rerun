'use client'

import { useBrand } from '@/components/brand/BrandProvider'
import { isWhiteLabel } from '@rerun/contracts'
import type { ReactNode } from 'react'

// Rerun's own pages, offers and community: an organization's clients never meet them.
export function RerunOnly({ children }: { children: ReactNode }) {
    return isWhiteLabel(useBrand()) ? null : children
}
