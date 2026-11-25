import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeHex } from '@rerun/contracts'

import type { Database } from '@/app/api/database.types'
import { BRAND_ICON_ACCEPT, BRAND_ICON_MIN, brandProblems } from '@/ee/components/organization/input'
import type { BrandFields } from '@/ee/components/organization/types'
import { forgetOrganizationBrands } from '@/ee/services/organization-brand.service'
import { readOrganization, type OrganizationContext, type OrganizationRow } from '@/ee/services/organization-context.service'
import { AppError } from '@/lib/i18n/action-error'
import { randomUuid } from '@/lib/random-uuid'
import { LOGO_MAX_BYTES } from '@/lib/workspace/logo-input'

type OrganizationUpdate = Database['public']['Tables']['organizations']['Update']

const ICON_BUCKET = 'organization-icons'
const IMMUTABLE_CACHE_CONTROL = '31536000'

export type OrganizationBrandSettings = { fields: BrandFields; iconUrl: string | null }

function brandSettingsOf(organization: OrganizationRow): OrganizationBrandSettings {
    return {
        fields: {
            name: organization.name,
            color: organization.color ?? '',
            supportEmail: organization.support_email ?? '',
            docsUrl: organization.docs_url ?? '',
            termsUrl: organization.terms_url ?? '',
            privacyUrl: organization.privacy_url ?? '',
        },
        iconUrl: organization.icon_url,
    }
}

export async function loadOrganizationBrandSettings({ supabase, organization }: OrganizationContext): Promise<OrganizationBrandSettings> {
    const { data, error } = await readOrganization(supabase, organization.id)
    if (error || !data) throw new Error(error?.message ?? 'The organization could not be read')
    return brandSettingsOf(data)
}

function fieldsOf(formData: FormData): BrandFields {
    const text = (key: keyof BrandFields) => String(formData.get(key) ?? '').trim()
    return { name: text('name'), color: text('color'), supportEmail: text('supportEmail'), docsUrl: text('docsUrl'), termsUrl: text('termsUrl'), privacyUrl: text('privacyUrl') }
}

// The fields of the page, and `icon` when another one was picked.
export async function updateOrganizationBrand({ supabase, organization }: OrganizationContext, formData: FormData): Promise<void> {
    const fields = fieldsOf(formData)
    if (Object.keys(brandProblems(fields)).length > 0) throw new AppError('brandInvalid')

    const icon = formData.get('icon')
    const iconUrl = icon instanceof File ? await hostIcon(supabase, organization.id, icon) : null
    const { error } = await supabase
        .from('organizations')
        .update<OrganizationUpdate>({
            name: fields.name,
            color: fields.color ? normalizeHex(fields.color) : null,
            support_email: fields.supportEmail || null,
            docs_url: fields.docsUrl || null,
            terms_url: fields.termsUrl || null,
            privacy_url: fields.privacyUrl || null,
            ...(iconUrl ? { icon_url: iconUrl } : {}),
        })
        .eq('id', organization.id)
    if (error) throw new Error(error.message)
    forgetOrganizationBrands()
}

// A PNG at the size of an installed app: what a mail client and a phone's home screen both draw.
async function hostIcon(supabase: SupabaseClient<Database>, organizationId: string, file: File): Promise<string> {
    if (!BRAND_ICON_ACCEPT.split(',').includes(file.type)) throw new AppError('chooseImage')
    if (file.size > LOGO_MAX_BYTES) throw new AppError('imageTooLarge', { max: LOGO_MAX_BYTES / (1024 * 1024) })
    const bytes = await drawIcon(new Uint8Array(await file.arrayBuffer()))

    await supabase.storage.createBucket(ICON_BUCKET, { public: true }).catch(() => {})
    const path = `${organizationId}/${randomUuid()}.png`
    const { error } = await supabase.storage.from(ICON_BUCKET).upload(path, bytes, { contentType: 'image/png', cacheControl: IMMUTABLE_CACHE_CONTROL })
    if (error) throw new Error(error.message)
    return supabase.storage.from(ICON_BUCKET).getPublicUrl(path).data.publicUrl
}

async function drawIcon(bytes: Uint8Array): Promise<Uint8Array> {
    const { default: sharp } = await import('sharp')
    const read = await sharp(Buffer.from(bytes)).metadata().catch(() => null)
    if (!read || !['png', 'jpeg', 'webp'].includes(read.format ?? '') || !read.width || !read.height) throw new AppError('imageUnreadable')
    if (read.width !== read.height) throw new AppError('brandIconNotSquare')
    if (read.width < BRAND_ICON_MIN) throw new AppError('brandIconTooSmall', { min: BRAND_ICON_MIN })
    const drawn = await sharp(Buffer.from(bytes))
        .rotate()
        .resize(BRAND_ICON_MIN, BRAND_ICON_MIN)
        .png()
        .toBuffer()
        .catch(() => null)
    if (!drawn) throw new AppError('imageUnreadable')
    return new Uint8Array(drawn)
}
