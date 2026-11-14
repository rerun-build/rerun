/**
 * The single map of the gallery, shared by both indexes so they can never drift. `landing` pages
 * render the bricks of this package, `app` pages render what only `apps/ui` can import. The split
 * is a hard boundary: the two apps are separate Next builds and only this package crosses.
 */
export type KitCategory = {
    slug: string
    label: string
    blurb: string
    host: 'landing' | 'app'
}

export const KIT_CATEGORIES: KitCategory[] = [
    { host: 'landing', slug: 'foundations', label: 'Foundations', blurb: 'Color, type, shape, motion and the isometric projection, with every value the product uses and the rules behind them.' },
    { host: 'landing', slug: 'primitives', label: 'Primitives and controls', blurb: 'Buttons, badges, icons, switches, cards, tables, the small pieces everything else is built from.' },
    { host: 'landing', slug: 'forms', label: 'Forms', blurb: 'Field, inputs, selects, the dropzone, and what a form looks like when it goes wrong.' },
    { host: 'landing', slug: 'chat-blocks', label: 'Conversation blocks', blurb: 'The shared chat vocabulary: messages, tool calls, reasoning, approvals, questions.' },
    { host: 'landing', slug: 'board', label: 'The isometric board', blurb: 'Tiles, their six effects, coworker statuses, containers, links and toasts.' },
    { host: 'landing', slug: 'brand-decor', label: 'Brand and decor', blurb: 'Logo, border beams, shimmer, model pills, cursors, the 49 banner illustrations.' },
    { host: 'app', slug: 'composer', label: 'The composer', blurb: 'The prompt input in full, the conversation frame, its empty state and suggestions.' },
    { host: 'app', slug: 'chat', label: 'The app conversation', blurb: 'Messages as the product renders them: tool blocks, sub runs, compaction, notices, session tabs.' },
    { host: 'app', slug: 'attachments-voice', label: 'Attachments and voice', blurb: 'Attachment tiles, the lightbox, the upload tray, and every state of the voice recorder.' },
    { host: 'app', slug: 'surfaces', label: 'Surfaces and panels', blurb: 'Dialogs and bottom sheets, the side panel and its rail, panel rows, editors and menus.' },
    { host: 'app', slug: 'states', label: 'Loading, empty and feedback', blurb: 'The nine skeletons, empty states, gauges, progress, toasts and the nine coworker statuses.' },
    { host: 'app', slug: 'chrome', label: 'App chrome', blurb: 'The switchers, the toolbar menus, the banners, and the interactive board itself.' },
    { host: 'app', slug: 'agent-box', label: 'Coworker, Box and data', blurb: 'The coworker panel and its tabs, model selector, triggers, skills, connections and the data browser.' },
    { host: 'app', slug: 'templates', label: 'Templates', blurb: 'Template cards, rows, the detail panel, the capture wizard and the creator revenue views.' },
    { host: 'app', slug: 'files', label: 'Files', blurb: 'The file browser of a Box, with its drawn glyphs, its tiles and its empty state.' },
    { host: 'app', slug: 'scenes', label: 'Scenes and stories', blurb: 'The auth scene, the explainers, the tour and the OG stages.' },
]

export const LANDING_CATEGORIES = KIT_CATEGORIES.filter(category => category.host === 'landing')
export const APP_CATEGORIES = KIT_CATEGORIES.filter(category => category.host === 'app')

export function kitCategoryPath(category: KitCategory) {
    return category.host === 'landing' ? `/brand/ui/${category.slug}` : `/render/kit/${category.slug}`
}
