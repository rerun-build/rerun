import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

// No lifetime codes to redeem on a self-hosted install: the page does not exist.
export const redeemMetadata: Metadata = {}

export function RedeemLayout({ children }: { children: React.ReactNode }) {
    return children
}

export function RedeemPage(_props: { searchParams: Promise<{ code?: string | string[]; session_id?: string | string[] }> }): never {
    notFound()
}
