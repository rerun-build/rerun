import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const redeemMetadata: Metadata = {}

export function RedeemLayout({ children }: { children: React.ReactNode }) {
    return children
}

export function RedeemPage(_props: { searchParams: Promise<{ code?: string | string[] }> }): never {
    notFound()
}
