import { TEMPLATE_CATEGORIES, type TemplateCategory, type TemplateFaqItem } from '@rerun/contracts'
import { generateObject } from 'ai'
import { z } from 'zod'
import { openrouter } from '@/lib/ai/openrouter'
import { describeTemplate, type TemplateBrief } from '@/lib/templates/describe'
import { VOICE, clean, stripDashes } from '@/lib/templates/voice'
import {
    FAQ_ANSWER_LIMIT,
    FAQ_MAX_ITEMS,
    FAQ_MIN_ITEMS,
    FAQ_QUESTION_LIMIT,
    IMAGE_ALT_LIMIT,
    META_DESCRIPTION_LIMIT,
    META_DESCRIPTION_MIN,
    META_TITLE_LIMIT,
    TAGLINE_LIMIT,
    TITLE_LIMIT,
} from '@/lib/templates/limits'

const PREFILL_MODEL = 'anthropic/claude-opus-5.5'

const contentSchema = z.object({
    tagline: z
        .string()
        .describe(
            `One sentence, ${TAGLINE_LIMIT} characters maximum, describing what the coworker actually does and what it produces. No trailing period is required. Never mention Rerun by name.`,
        ),
    longDescription: z
        .string()
        .describe(
            [
                'Markdown, 150 to 300 words, in a restricted subset. ALLOWED: paragraphs, "## " and "### " headings, **bold**, *italic*, "- " bullet lists, "1. " numbered lists, "> " quotes, [text](url) links.',
                'FORBIDDEN and never to be produced: "# " level one headings, "#### " or deeper, code fences, indented code, horizontal rules, tables, images, raw HTML.',
                'Structure: one short opening paragraph saying what the template does and who it is for, then one or two "## " sections along the lines of "What it does" and "How it works".',
                'Never write a requirements or setup section, and never list the apps, the accounts or the keys the template needs: the page already shows them on its own.',
            ].join(' '),
        ),
})

const metaSchema = z.object({
    title: z
        .string()
        .describe(
            [
                `The name of the template in the catalogue, ${TITLE_LIMIT} characters maximum. Prefer the shortest natural title that still names the job and its essential service.`,
                'Open with the verb of the work being done, name the concrete output, then name the services it runs on with "with", "via" or "from".',
                'The shape to follow: "Track SEO Keyword Rankings with Bright Data and GPT-5 Analysis", "Send Multiple Emails in Gmail Directly from Google Sheets", "Draft and Schedule LinkedIn Posts from a Notion Backlog with Claude".',
                'Title Case, like every page title of the site: each word capitalised except the short function words (a, and, for, from, of, to, with, via). Never a trailing period, never the words "template", "AI coworker that", "automation that", never a brand suffix.',
                'Name only the services the brief actually lists.',
            ].join(' '),
        ),
    slugWords: z
        .string()
        .describe(
            'The same job named in the shortest way possible, for the URL: 3 to 6 lowercase words separated by spaces, no punctuation. Keep the verb and the main service, drop the rest.',
        ),
    category: z
        .enum(TEMPLATE_CATEGORIES)
        .describe(
            'The audience this setup is built for, picked from the list. Pick the line of business first ("agencies", "ecommerce", "saas", "recruiting", "real-estate", "legal", "creators"); use "sales" for pipeline work whatever the industry, "productivity" for work anyone does regardless of their business (inbox, meetings, calendar, invoices, internal recaps), and "other" only when nothing fits.',
        ),
    tags: z
        .array(z.string())
        .min(3)
        .max(6)
        .describe(
            'Filter tags, lowercase, one or two words each. Name the job, the output and the main services. Never repeat the whole title, never two tags that mean the same thing.',
        ),
    metaTitle: z
        .string()
        .describe(
            `Search result title, ${META_TITLE_LIMIT} characters maximum, in Title Case. The short version of the title above, not a different name: same verb, same job, fewer services. No brand suffix.`,
        ),
    metaDescription: z
        .string()
        .describe(
            `Search result description, between ${META_DESCRIPTION_MIN} and ${META_DESCRIPTION_LIMIT} characters, never shorter and never longer, one or two sentences answering what someone searching for this workflow wants to know. Written to be read in a result list, not as a slogan.`,
        ),
})

const faqSchema = z.object({
    faq: z
        .array(
            z.object({
                question: z
                    .string()
                    .describe(
                        `The question as someone would type it into a search box, ${FAQ_QUESTION_LIMIT} characters maximum, ending with a question mark. Written from the reader point of view ("Which accounts do I need to connect?", "How often does it run?"). Never "What is X?" and never a question the brief cannot answer.`,
                    ),
                answer: z
                    .string()
                    .describe(
                        `Two or three sentences, ${FAQ_ANSWER_LIMIT} characters maximum, plain text with no markdown. Answer from what the coworkers, the skills, the schedules and the services in the brief actually say. Give the specific answer first, then the detail.`,
                    ),
            }),
        )
        .min(FAQ_MIN_ITEMS)
        .max(FAQ_MAX_ITEMS)
        .describe(
            'Cover different ground with each entry: what the setup requires, how it runs, what it produces, what it does not do. Never two questions that share an answer.',
        ),
})

const altTextSchema = z.object({
    alt: z
        .string()
        .describe(
            `Alt text for the image, ${IMAGE_ALT_LIMIT} characters maximum. Describe what is actually visible: the object, its material, the lighting, the composition. Never start with "image of", "picture of" or "a photo of".`,
        ),
})

export async function generateTemplateContent(brief: TemplateBrief): Promise<{ tagline: string; longDescription: string }> {
    const { object } = await generateObject({
        model: openrouter(PREFILL_MODEL),
        schema: contentSchema,
        system: `${VOICE}

You are writing the Content section of a template page: the tagline that shows on the card, and the long description that shows on the page itself.`,
        prompt: describeTemplate(brief),
    })

    return {
        tagline: clean(object.tagline, TAGLINE_LIMIT),
        longDescription: cleanMarkdown(object.longDescription),
    }
}

export type TemplateMeta = {
    title: string
    slugWords: string
    category: TemplateCategory
    tags: string[]
    metaTitle: string
    metaDescription: string
}

// The title the brief carries was typed in the new template dialog, before a single agent was
// captured, so it is a working name and never a constraint on the one written here.
export async function generateTemplateMeta(brief: TemplateBrief): Promise<TemplateMeta> {
    const { object } = await generateObject({
        model: openrouter(PREFILL_MODEL),
        schema: metaSchema,
        system: `${VOICE}

You are naming a template in a catalogue of hundreds, and writing the search engine metadata that goes with it. The name is the whole pitch: someone scanning the list has to know which job gets done and with which tools without opening the page.`,
        prompt: `${describeTemplate(brief)}

The "Template" line is the working name its author typed before capturing anything. Replace it with a name that says what these coworkers actually do.`,
    })

    return {
        title: clean(object.title, TITLE_LIMIT),
        slugWords: object.slugWords,
        category: object.category,
        tags: [...new Set(object.tags.map(tag => tag.toLowerCase().trim()).filter(Boolean))],
        metaTitle: clean(object.metaTitle, META_TITLE_LIMIT),
        metaDescription: clean(object.metaDescription, META_DESCRIPTION_LIMIT),
    }
}

// The long description is passed as context to be avoided, not summarised: a FAQ that repeats
// the section above it earns nothing in search. It stays out of the brief because the brief is
// shared with the writer that produces that description in the first place.
export async function generateTemplateFaq({ brief, longDescription }: { brief: TemplateBrief; longDescription: string }): Promise<TemplateFaqItem[]> {
    const context = longDescription.trim()
        ? `${describeTemplate(brief)}\n\nThe page already says this above the FAQ, so do not restate it:\n${longDescription.trim()}`
        : describeTemplate(brief)

    const { object } = await generateObject({
        model: openrouter(PREFILL_MODEL),
        schema: faqSchema,
        system: `${VOICE}

You are writing the FAQ of a template page. Search engines show these questions in the result itself, so each one has to be a question someone really asks before installing a coworker, and each answer has to settle it on its own.
Ask about what the setup needs and about how it runs before anything else. When the brief lists schedules, one question covers the frequency. When it lists services, one question covers the accounts required.
Never answer a question the brief does not support, and never promise an outcome it does not describe.`,
        prompt: context,
    })

    return object.faq.map(item => ({
        question: asQuestion(clean(item.question, FAQ_QUESTION_LIMIT)),
        answer: clean(item.answer, FAQ_ANSWER_LIMIT),
    }))
}

// Truncating at the limit takes the question mark with it, and an entry that does not end on
// one reads as a cut off string in the accordion.
function asQuestion(value: string): string {
    return value.endsWith('?') ? value : `${value}?`
}

// The image itself is the source of truth here: the template only tells the writer which
// vocabulary belongs to this job, so the alt text lands on the page it illustrates.
export async function generateImageAltText({
    brief,
    imageUrl,
    isCover,
}: {
    brief: TemplateBrief
    imageUrl: string
    isCover: boolean
}): Promise<string> {
    const { object } = await generateObject({
        model: openrouter(PREFILL_MODEL),
        schema: altTextSchema,
        system: `${VOICE}

You are writing the alt text of an image on a template page that search engines index. Describe the image in front of you, not the template. The template brief is only there to tell you which words name the objects you see.`,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `${describeTemplate(brief)}\n\nThis is the ${isCover ? 'cover image' : 'gallery image'} of that template. Write its alt text.`,
                    },
                    { type: 'image', image: new URL(imageUrl) },
                ],
            },
        ],
    })

    return clean(object.alt, IMAGE_ALT_LIMIT)
}

function cleanMarkdown(value: string): string {
    return stripDashes(value)
        .replace(/^#{4,}\s+/gm, '### ')
        .replace(/^#\s+/gm, '## ')
        .replace(/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
        .trim()
}
