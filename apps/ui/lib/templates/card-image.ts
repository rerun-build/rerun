import type { LibraryTemplate } from './library'

// A board capture and an authored cover are not interchangeable downstream: the board is fitted to
// its frame with no bleed, so it may not be cropped the way a cover can. A board also comes as a
// pair, one image per theme; a cover has no variant, which is what `lightSrc: null` says.
// A cover's `alt` is its own text; a board's is the template's title, which TemplateCardThumbnail
// words as a board in the reader's language.
export type TemplateCardImage = { src: string; lightSrc: string | null; alt: string; kind: 'board' | 'cover' }

type CardImageSource = Pick<LibraryTemplate, 'title' | 'gallery' | 'cardImageDarkUrl' | 'cardImageLightUrl'>

// The board is the thumbnail wherever there is a full pair to draw. Only half a pair means a
// capture is in flight or failed, and half a pair would show the wrong theme to somebody.
export function templateCardImage(template: CardImageSource): TemplateCardImage | null {
    if (template.cardImageDarkUrl && template.cardImageLightUrl) {
        return { src: template.cardImageDarkUrl, lightSrc: template.cardImageLightUrl, alt: template.title, kind: 'board' }
    }

    const cover = template.gallery[0]
    if (cover) return { src: cover.url, lightSrc: null, alt: cover.alt || template.title, kind: 'cover' }

    return null
}
