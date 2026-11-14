import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

const missing = async (): Promise<Response> => new Response(null, { status: 404 })

export const brandOgRoute = missing
export const compareOgRoute = missing
export const expertOgRoute = missing

function NoCard(): never {
    notFound()
}

export const BrandOgRenderPage = NoCard
export const CompareOgGalleryPage = NoCard
export const CompareOgRenderPage = NoCard
export const brandOgRenderMetadata: Metadata = {}
export const compareOgGalleryMetadata: Metadata = {}
export const compareOgRenderMetadata: Metadata = {}
