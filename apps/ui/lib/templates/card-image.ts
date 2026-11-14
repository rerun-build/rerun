import type { LibraryTemplate } from './library'

export type TemplateCardImage = { src: string; lightSrc: string | null; alt: string; kind: 'board' | 'cover' }

type CardImageSource = Pick<LibraryTemplate, 'title' | 'gallery' | 'cardImageDarkUrl' | 'cardImageLightUrl'>

export function templateCardImage(template: CardImageSource): TemplateCardImage | null {
    if (template.cardImageDarkUrl && template.cardImageLightUrl) {
        return { src: template.cardImageDarkUrl, lightSrc: template.cardImageLightUrl, alt: `${template.title} coworker board`, kind: 'board' }
    }

    const cover = template.gallery[0]
    if (cover) return { src: cover.url, lightSrc: null, alt: cover.alt || template.title, kind: 'cover' }

    return null
}
