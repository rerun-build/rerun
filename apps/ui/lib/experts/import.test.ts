import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/supabase-fake'

vi.mock('./scrape', () => ({ scrapeProfile: vi.fn() }))
vi.mock('./enrich', () => ({ enrichExpert: vi.fn() }))
vi.mock('./rehost', () => ({ rehostAvatar: vi.fn(), rehostBanner: vi.fn() }))
vi.mock('@moldwright/db', () => ({ randomExpertBannerUrl: vi.fn() }))

import { randomExpertBannerUrl } from '@moldwright/db'
import { enrichExpert, type EnrichedExpert } from './enrich'
import { importExpert } from './import'
import { rehostAvatar, rehostBanner } from './rehost'
import { scrapeProfile } from './scrape'

const ENRICHED: EnrichedExpert = {
    name: 'Jane Doe',
    type: 'freelancer',
    email: '',
    location: '',
    timezone: 'Not/AZone',
    bio: '',
    budget: null,
    skills: [],
    languages: [],
    x_url: '',
    linkedin_url: '',
    github_url: 'https://github.com/jane',
    website_url: '',
}

function setup(takenSlugs: string[], insertError: { message: string } | null = null) {
    return fakeSupabase((table, calls) => {
        if (table !== 'experts') return
        if (calls.some(c => c.method === 'insert')) return { error: insertError }
        const slug = calls.find(c => c.method === 'eq' && c.args[0] === 'slug')?.args[1] as string
        return { data: takenSlugs.includes(slug) ? { id: 'x' } : null }
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(scrapeProfile).mockResolvedValue({ raw: {}, photoUrl: null, bannerUrl: null })
    vi.mocked(enrichExpert).mockResolvedValue(ENRICHED)
    vi.mocked(rehostAvatar).mockResolvedValue(null)
    vi.mocked(rehostBanner).mockResolvedValue(null)
    vi.mocked(randomExpertBannerUrl).mockResolvedValue('https://banners/1.png')
})

describe('importExpert', () => {
    it('takes the slug of the name when it is free', async () => {
        const db = setup([])
        expect(await importExpert(db.client, 'https://www.linkedin.com/in/jane')).toEqual({ url: 'https://www.linkedin.com/in/jane', ok: true, slug: 'jane-doe', name: 'Jane Doe' })
    })

    it('numbers the slug from 2 until one is free', async () => {
        const db = setup(['jane-doe', 'jane-doe-2'])
        const result = await importExpert(db.client, 'https://www.linkedin.com/in/jane')
        expect(result).toMatchObject({ ok: true, slug: 'jane-doe-3' })
        expect(db.writes('experts')[0].payload).toMatchObject({ slug: 'jane-doe-3' })
    })

    it('falls back to the X handle, then to "expert", when the name slugifies to nothing', async () => {
        vi.mocked(enrichExpert).mockResolvedValue({ ...ENRICHED, name: '李' })
        expect(await importExpert(setup([]).client, 'https://x.com/JaneD')).toMatchObject({ ok: true, slug: 'janed' })
        expect(await importExpert(setup([]).client, 'https://www.linkedin.com/in/li')).toMatchObject({ ok: true, slug: 'expert' })
    })

    it('gives up after 99 taken slugs', async () => {
        const taken = ['jane-doe', ...Array.from({ length: 98 }, (_, i) => `jane-doe-${i + 2}`)]
        expect(await importExpert(setup(taken).client, 'https://www.linkedin.com/in/jane')).toMatchObject({ ok: false, error: 'Could not find a free slug for "jane-doe"' })
    })

    it('writes the canonical source URL, a null invalid timezone and blank fields as null', async () => {
        const db = setup([])
        await importExpert(db.client, 'https://twitter.com/JaneD?s=21')
        expect(db.writes('experts')[0].payload).toMatchObject({ x_url: 'https://x.com/JaneD', linkedin_url: null, timezone: null, email: null, github_url: 'https://github.com/jane', status: 'draft', banner_url: 'https://banners/1.png' })
    })

    it('prefers the rehosted banner over a random illustration', async () => {
        vi.mocked(scrapeProfile).mockResolvedValue({ raw: {}, photoUrl: 'https://p', bannerUrl: 'https://b' })
        vi.mocked(rehostAvatar).mockResolvedValue('https://avatar')
        vi.mocked(rehostBanner).mockResolvedValue('https://banner')
        const db = setup([])
        await importExpert(db.client, 'https://www.linkedin.com/in/jane')
        expect(db.writes('experts')[0].payload).toMatchObject({ avatar_url: 'https://avatar', banner_url: 'https://banner' })
        expect(randomExpertBannerUrl).not.toHaveBeenCalled()
    })

    it('reports every failure as a result instead of throwing', async () => {
        expect(await importExpert(setup([]).client, 'https://example.com/jane')).toMatchObject({ ok: false, error: 'Unsupported profile URL: https://example.com/jane' })
        vi.mocked(randomExpertBannerUrl).mockResolvedValue(null)
        expect(await importExpert(setup([]).client, 'https://www.linkedin.com/in/jane')).toMatchObject({ ok: false, error: expect.stringContaining('No banner illustration') })
        vi.mocked(randomExpertBannerUrl).mockResolvedValue('https://banners/1.png')
        expect(await importExpert(setup([], { message: 'duplicate key' }).client, 'https://www.linkedin.com/in/jane')).toMatchObject({ ok: false, error: 'duplicate key' })
    })
})
