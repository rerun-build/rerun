import { SEO_DESCRIPTION_MAX_LENGTH, SEO_DESCRIPTION_MIN_LENGTH, TEMPLATE_TITLE_MAX_LENGTH } from '@moldwright/contracts'
import { copyOf } from '@/lib/copy-name'

export const MAX_TEMPLATES_PER_AUTHOR = 100
export const MAX_TEMPLATE_GALLERY_IMAGES = 8

export const TITLE_LIMIT = TEMPLATE_TITLE_MAX_LENGTH
export const TAGLINE_LIMIT = 160
export const META_TITLE_LIMIT = 60
export const META_DESCRIPTION_MIN = SEO_DESCRIPTION_MIN_LENGTH
export const META_DESCRIPTION_LIMIT = SEO_DESCRIPTION_MAX_LENGTH
export const IMAGE_ALT_LIMIT = 125
export const FAQ_QUESTION_LIMIT = 100
export const FAQ_ANSWER_LIMIT = 320
export const FAQ_MIN_ITEMS = 4
export const FAQ_MAX_ITEMS = 6

export function duplicateTemplateTitle(title: string): string {
    return copyOf(title, TITLE_LIMIT)
}
