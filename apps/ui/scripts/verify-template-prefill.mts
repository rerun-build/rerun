import { TEMPLATE_CATEGORIES } from '@rerun/contracts'
import { selectMany } from '@rerun/db/helpers'
import { loadServiceCatalog } from '../lib/templates/catalog'
import { toTemplateBrief, withConnectorNames } from '../lib/templates/describe'
import { rowToDocument, TEMPLATE_DOC_COLUMNS, type TemplateRow } from '../lib/templates/document'
import { IMAGE_ALT_LIMIT, META_DESCRIPTION_LIMIT, META_TITLE_LIMIT, TAGLINE_LIMIT, TITLE_LIMIT } from '../lib/templates/limits'
import { slugify } from '../lib/slugify'
import { generateImageAltText, generateTemplateContent, generateTemplateMeta } from '../lib/templates/prefill'
import { createServiceRoleClient } from '../supabase/serviceRole'

const slug = process.argv[2]

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++
        console.log(`  ok    ${label}`)
    } else {
        failed++
        console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ''}`)
    }
}

const supabase = createServiceRoleClient()
const { data: rows, error } = await selectMany(supabase, 'templates', TEMPLATE_DOC_COLUMNS, slug ? { slug } : {}, { column: 'created_at', ascending: false }, 20)
if (error) throw error
const documents = (rows ?? []).map(row => rowToDocument(row as TemplateRow))
const document = documents.find(doc => doc.agents.length > 0 && doc.gallery.length > 0) ?? documents[0]
if (!document) throw new Error('No template found to verify against.')
const brief = toTemplateBrief(document)
console.log(`Template: ${document.title} (${document.slug}), ${brief.agents.length} agent(s)\n`)

const hasDash = (value: string) => /[–—]/.test(value)

console.log('1. Content')
const content = await generateTemplateContent(brief)
console.log(`\n  ${content.tagline}\n`)
console.log(`${content.longDescription}\n`)

check('tagline within the cap', content.tagline.length > 0 && content.tagline.length <= TAGLINE_LIMIT, `${content.tagline.length} chars`)
check('tagline is one sentence', content.tagline.split(/[.!?]\s/).length <= 2, content.tagline)
check('tagline has no dash', !hasDash(content.tagline))
check('long description is substantial', content.longDescription.length > 300, `${content.longDescription.length} chars`)
check('long description has no dash', !hasDash(content.longDescription))
check('uses h2 sections', /^## \S/m.test(content.longDescription))
check('no h1', !/^# /m.test(content.longDescription))
check('no h4 or deeper', !/^#{4,} /m.test(content.longDescription))
check('no code fence', !content.longDescription.includes('```'))
check('no table', !/^\s*\|/m.test(content.longDescription))
check('no horizontal rule', !/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m.test(content.longDescription))
check('no raw html', !/<[a-z][^>]*>/i.test(content.longDescription))
check('no markdown image', !/!\[/.test(content.longDescription))

console.log('2. Metadata')
const catalog = await loadServiceCatalog(supabase, brief.connectors)
const named = withConnectorNames(brief, new Map([...catalog].map(([slug, entry]) => [slug, entry.name])))
const meta = await generateTemplateMeta(named)
console.log(`\n  ${meta.title}\n  /templates/${slugify(meta.slugWords)}\n  ${meta.category} | ${meta.tags.join(', ')}\n  ${meta.metaTitle}\n  ${meta.metaDescription}\n`)

check('title within the cap', meta.title.length > 0 && meta.title.length <= TITLE_LIMIT, `${meta.title.length} chars`)
check('title says more than the working name', meta.title.split(/\s+/).length >= 5, meta.title)
check('title is not the working name', meta.title.toLowerCase() !== document.title.toLowerCase(), meta.title)
check('title does not end on a period', !meta.title.endsWith('.'), meta.title)
check('title does not call itself a template', !/\b(template|workflow automation)\b/i.test(meta.title), meta.title)
check('title has no dash', !hasDash(meta.title))
check('slug words produce a usable slug', slugify(meta.slugWords).length > 0, meta.slugWords)
check('slug stays short', slugify(meta.slugWords).split('-').length <= 6, slugify(meta.slugWords))
check('category is a real one', (TEMPLATE_CATEGORIES as readonly string[]).includes(meta.category), meta.category)
check('tags are usable', meta.tags.length >= 3 && meta.tags.every(tag => tag === tag.toLowerCase() && tag.split(/\s+/).length <= 2), meta.tags.join(', '))
check('meta title within the cap', meta.metaTitle.length > 0 && meta.metaTitle.length <= META_TITLE_LIMIT, `${meta.metaTitle.length} chars`)
check('meta description within the cap', meta.metaDescription.length > 0 && meta.metaDescription.length <= META_DESCRIPTION_LIMIT, `${meta.metaDescription.length} chars`)
check('meta description is not a stub', meta.metaDescription.length > 80, `${meta.metaDescription.length} chars`)
check('metadata has no dash', !hasDash(meta.metaTitle) && !hasDash(meta.metaDescription))

console.log('3. Alt text')
const image = document.gallery[0]
if (!image) {
    console.log('  skipped, this template has no gallery image')
} else {
    console.log(`  ${image.url}`)
    const alt = await generateImageAltText({ brief, imageUrl: image.url, isCover: true })
    console.log(`\n  ${alt}\n`)

    check('alt within the cap', alt.length > 0 && alt.length <= IMAGE_ALT_LIMIT, `${alt.length} chars`)
    check('alt is descriptive', alt.split(/\s+/).length >= 4, alt)
    check('alt does not announce itself', !/^(an?\s+)?(image|picture|photo|screenshot)\s+of\b/i.test(alt), alt)
    check('alt has no dash', !hasDash(alt))
    check('alt does not trail off', !/[\s,;:]$/.test(alt), alt)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
