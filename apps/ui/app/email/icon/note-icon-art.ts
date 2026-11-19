import type { NoteIcon } from '@moldwright/emails'

export const ICON_SIZE = 18
const SCALE = 2
const VIEWBOX = 18

const SURFACE = '#171717'
const INK = '#a1a1a1'
const STROKE_WIDTH = 1.4

const ICONS = {
    fix:
        '<path d="M11.75,16.25v-2.644c2.071-1.018,3.5-3.143,3.5-5.606,0-2.657-1.661-4.922-4-5.826V7.25c0,.552-.448,1-1,1h-2.5c-.552,0-1-.448-1-1V2.174c-2.339,.904-4,3.168-4,5.826,0,2.463,1.429,4.588,3.5,5.606v2.644" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    speed:
        '<path d="M14.7505 7.25H9.49905L9.81065 1.9868C9.82325 1.7732 9.55085 1.6734 9.42255 1.8446L3.04965 10.3501C2.92615 10.5149 3.04376 10.75 3.24976 10.75H8.50115L8.18955 16.0132C8.17695 16.2268 8.44935 16.3266 8.57765 16.1554L14.9506 7.6499C15.0741 7.4851 14.9565 7.25 14.7505 7.25Z" stroke="COLOR" stroke-width="SW" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    chat:
        '<path d="M13.75,2.75H4.25c-1.105,0-2,.895-2,2v11.5l3.75-3h7.75c1.105,0,2-.895,2-2V4.75c0-1.105-.895-2-2-2Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    board:
        '<rect x="2.75" y="10.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="10.75" y="10.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="10.75" y="2.75" width="4.5" height="4.5" rx="1" ry="1" transform="translate(7.343 -7.728) rotate(45)" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="2.75" y="2.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    connector:
        '<line x1="6.25" y1="4.75" x2="6.25" y2="1.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="11.75" y1="4.75" x2="11.75" y2="1.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M3.75,4.75H14.25c.552,0,1,.448,1,1v1.75c0,3.449-2.801,6.25-6.25,6.25h0c-3.449,0-6.25-2.801-6.25-6.25v-1.75c0-.552,.448-1,1-1Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="9" y1="16.25" x2="9" y2="13.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    mobile:
        '<path d="M10.5 2H7.5V2.75H10.5V2Z" stroke="COLOR" stroke-width="SW" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
        '<path d="M12.25 1.75H5.75C4.6454 1.75 3.75 2.6454 3.75 3.75V14.25C3.75 15.3546 4.6454 16.25 5.75 16.25H12.25C13.3546 16.25 14.25 15.3546 14.25 14.25V3.75C14.25 2.6454 13.3546 1.75 12.25 1.75Z" stroke="COLOR" stroke-width="SW" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    setting:
        '<line x1="13.25" y1="5.25" x2="16.25" y2="5.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="1.75" y1="5.25" x2="8.75" y2="5.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<circle cx="11" cy="5.25" r="2.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="4.75" y1="12.75" x2="1.75" y2="12.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="16.25" y1="12.75" x2="9.25" y2="12.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<circle cx="7" cy="12.75" r="2.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    email:
        '<path d="M1.75,5.75l6.767,3.733c.301,.166,.665,.166,.966,0l6.767-3.733" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="1.75" y="3.25" width="14.5" height="11.5" rx="2" ry="2" transform="translate(18 18) rotate(180)" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    schedule:
        '<circle cx="9" cy="9" r="7.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<polyline points="9 4.75 9 9 12.25 11.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    file:
        '<path d="M15.16,6.25h-3.41c-.552,0-1-.448-1-1V1.852" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M2.75,14.25V3.75c0-1.105,.895-2,2-2h5.586c.265,0,.52,.105,.707,.293l3.914,3.914c.188,.188,.293,.442,.293,.707v7.586c0,1.105-.895,2-2,2H4.75c-1.105,0-2-.895-2-2Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    access:
        '<path d="M9.305,1.848l5.25,1.68c.414,.133,.695,.518,.695,.952v6.52c0,3.03-4.684,4.748-5.942,5.155-.203,.066-.413,.066-.616,0-1.258-.407-5.942-2.125-5.942-5.155V4.48c0-.435,.281-.82,.695-.952l5.25-1.68c.198-.063,.411-.063,.61,0Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<polyline points="6.497 9.75 8.106 11.25 11.503 6.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    display:
        '<path d="M9 11.75C10.5188 11.75 11.75 10.5188 11.75 9C11.75 7.48122 10.5188 6.25 9 6.25C7.48122 6.25 6.25 7.48122 6.25 9C6.25 10.5188 7.48122 11.75 9 11.75Z" stroke="COLOR" stroke-width="SW" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
        '<path d="M15.9557 7.88669C16.3481 8.57939 16.3481 9.42049 15.9557 10.1132C15.0087 11.7849 12.7944 14.4999 9 14.4999C5.2056 14.4999 2.9912 11.7849 2.0443 10.1132C1.6519 9.42049 1.6519 8.57939 2.0443 7.88669C2.9913 6.21499 5.2056 3.5 9 3.5C12.7944 3.5 15.0088 6.21499 15.9557 7.88669Z" stroke="COLOR" stroke-width="SW" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
} as const satisfies Record<NoteIcon, string>

export function buildIconSvg(name: NoteIcon): string {
    const box = VIEWBOX * SCALE
    const markup = ICONS[name].replaceAll('COLOR', INK).replaceAll('SW', String(STROKE_WIDTH))

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">
  <rect width="${VIEWBOX}" height="${VIEWBOX}" fill="${SURFACE}"/>
  ${markup}
</svg>`
}
