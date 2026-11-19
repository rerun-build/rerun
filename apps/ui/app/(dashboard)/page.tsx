import { FactoryPage } from '@/components/factory/FactoryPage'
import { routes } from '@/lib/routes'
import { redirect } from 'next/navigation'

type Search = Record<string, string | string[] | undefined>

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams)) for (const item of typeof value === 'string' ? [value] : (value ?? [])) query.append(key, item)
    if (query.size > 0) redirect(`${routes.board}?${query}`)
    return <FactoryPage />
}
