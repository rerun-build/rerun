import type { ExpertAvailability, ExpertBadge, ExpertStatus, ExpertType } from './options'

export type Expert = {
    id: string
    slug: string
    name: string
    type: ExpertType
    badge: ExpertBadge
    location: string | null
    bio: string | null
    budget: string | null
    availability: ExpertAvailability
    avatarUrl: string | null
    bannerUrl: string
    initials: string
    skills: string[]
    languages: string[]
    xUrl: string | null
    linkedinUrl: string | null
    githubUrl: string | null
    websiteUrl: string | null
    featured: boolean
    seoIndexed: boolean
}

export type OwnerExpert = Expert & { email: string | null; status: ExpertStatus }

export type ExpertUploadResult = { ok: true; url: string } | { ok: false; error: string }
export type ExpertUpload = (formData: FormData) => Promise<ExpertUploadResult>

export function initialsFromName(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
