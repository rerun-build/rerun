import { agentImageRef, agentWorkspacePathFromHref } from '@rerun/contracts'
import { Lexer, type Token, type Tokens } from 'marked'
import { createContext, use, useMemo, type ReactNode } from 'react'
import { Text, View, type TextStyle } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import remend from 'remend'

import { ownedFileUrl, rawFileUrl, type FileOwner } from '@/api/files'
import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { EASE_OUT } from '@/theme/motion'
import { useTheme } from '@/theme/theme'
import { fonts, spacing, withAlpha } from '@/theme/tokens'

import { CodeBlock, DraftBlock, inlineCodeBackground } from './markdown/CodeBlock'
import { MarkdownImage } from './markdown/MarkdownImage'
import { MarkdownTable } from './markdown/MarkdownTable'
import { shortenUrl } from './markdown/short-link'
import { useOpenWorkspaceFile } from './markdown/useOpenWorkspaceFile'
import { openExternalUrl } from '@/lib/url'

// `page`: an answer's block standing on the thread. `bubble`: inside an answer's grey bubble.
// `brand`: inside the user's violet bubble, where every colour turns white.
export type MarkdownSurface = 'page' | 'bubble' | 'brand'

type MarkdownScope = { surface: MarkdownSurface; owner: FileOwner | null; shortLinks: boolean; muted: boolean }

const Scope = createContext<MarkdownScope>({ surface: 'page', owner: null, shortLinks: false, muted: false })

const HEADINGS: Record<number, TextStyle> = {
    1: { fontSize: 24, lineHeight: 32 },
    2: { fontSize: 20, lineHeight: 28 },
    3: { fontSize: 18, lineHeight: 26 },
}
const SMALL_HEADING: TextStyle = { fontSize: 16, lineHeight: 24 }

// The web's streamed words (streamdown, apps/ui/lib/chat/stream-animation.ts) blur in over 120 ms; a
// word on a phone cannot blur alone, so it fades and rises the few points of the web's `slideUp`.
const WORD_ENTERING = FadeInDown.duration(120)
    .easing(EASE_OUT)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 4 }] })

function useInk() {
    const theme = useTheme()
    const { surface, muted } = use(Scope)
    if (surface === 'brand') return { text: '#ffffff', link: '#ffffff', muted: withAlpha('#ffffff', 0.7), faint: withAlpha('#ffffff', 0.4) }
    return { text: muted ? theme.mutedForeground : theme.foreground, link: theme.primary, muted: theme.mutedForeground, faint: surface === 'bubble' ? withAlpha(theme.foreground, 0.2) : theme.border }
}

export function fileUrlOf(owner: FileOwner | null, src: string | undefined): string | null {
    if (src && /^https?:\/\//i.test(src)) return src
    const ref = agentImageRef(src)
    if (!ref || !owner) return null
    if (owner.kind === 'agent') return rawFileUrl({ agentId: owner.agentId, path: ref.path, scope: ref.scope })
    return ref.scope === 'agent' ? ownedFileUrl(owner, ref.path) : null
}

function InlineLink({ token, children }: { token: Tokens.Link; children: ReactNode }) {
    const ink = useInk()
    const { owner } = use(Scope)
    const openWorkspaceFile = useOpenWorkspaceFile()
    const workspacePath = agentWorkspacePathFromHref(token.href)
    const onPress = () => {
        if (workspacePath && owner?.kind === 'agent') {
            openWorkspaceFile(owner.agentId, workspacePath)
            return
        }
        openExternalUrl(token.href)
    }
    return (
        <Text onPress={onPress} accessibilityRole="link" style={{ color: ink.link, textDecorationLine: 'underline', fontFamily: workspacePath ? fonts.medium : undefined }}>
            {children}
        </Text>
    )
}

function renderInline(tokens: Token[] | undefined, key = ''): ReactNode[] {
    return (tokens ?? []).map((token, index) => <Inline key={`${key}${index}`} token={token} />)
}

function Inline({ token }: { token: Token }) {
    const theme = useTheme()
    const { surface, shortLinks } = use(Scope)
    switch (token.type) {
        case 'strong':
            return <Text style={{ fontFamily: fonts.semibold }}>{renderInline(token.tokens)}</Text>
        case 'em':
            return <Text style={{ fontFamily: fonts.italic }}>{renderInline(token.tokens)}</Text>
        case 'del':
            return <Text style={{ textDecorationLine: 'line-through' }}>{renderInline(token.tokens)}</Text>
        case 'codespan':
            return <Text style={{ fontFamily: fonts.mono, fontSize: 14, backgroundColor: inlineCodeBackground(theme, surface) }}>{` ${token.text} `}</Text>
        case 'br':
            return <Text>{'\n'}</Text>
        case 'link': {
            const link = token as Tokens.Link
            const bare = shortLinks && link.text === link.href
            return <InlineLink token={link}>{bare ? shortenUrl(link.href) : renderInline(link.tokens)}</InlineLink>
        }
        case 'image':
            return <Text>{(token as Tokens.Image).text}</Text>
        case 'escape':
            return <Text>{token.text}</Text>
        case 'html':
            return <Text>{token.text.replace(/<[^>]+>/g, '')}</Text>
        case 'text': {
            const text = token as Tokens.Text
            return <Text>{text.tokens ? renderInline(text.tokens) : decodeEntities(text.text)}</Text>
        }
        default:
            return 'text' in token && typeof token.text === 'string' ? <Text>{token.text}</Text> : null
    }
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

function decodeEntities(text: string): string {
    return text.replace(/&(amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity] ?? entity)
}

function Paragraph({ tokens, style }: { tokens: Token[] | undefined; style?: TextStyle }) {
    const ink = useInk()
    return (
        <AppText variant="body" selectable style={[{ color: ink.text }, style]}>
            {renderInline(tokens)}
        </AppText>
    )
}

type Word = { text: string; style: TextStyle }

function wordsOf(tokens: Token[] | undefined, style: TextStyle, words: Word[] = []): Word[] {
    for (const token of tokens ?? []) {
        if (token.type === 'strong') wordsOf(token.tokens, { ...style, fontFamily: fonts.semibold }, words)
        else if (token.type === 'em') wordsOf(token.tokens, { ...style, fontFamily: fonts.italic }, words)
        else if (token.type === 'del') wordsOf(token.tokens, { ...style, textDecorationLine: 'line-through' }, words)
        else if (token.type === 'link') wordsOf(token.tokens, { ...style, textDecorationLine: 'underline' }, words)
        else if (token.type === 'codespan') words.push({ text: token.text, style: { ...style, fontFamily: fonts.mono, fontSize: 14 } })
        else if (token.type === 'br') words.push({ text: '\n', style })
        else if (token.type === 'text' && (token as Tokens.Text).tokens) wordsOf((token as Tokens.Text).tokens, style, words)
        else if ('text' in token && typeof token.text === 'string') {
            for (const piece of decodeEntities(token.text).split(/(\n)/)) {
                if (piece === '\n') words.push({ text: '\n', style })
                else for (const word of piece.match(/\S+\s*|\s+/g) ?? []) words.push({ text: word, style })
            }
        }
    }
    return words
}

// While a paragraph is still being written each word is its own view, keyed by its place: a word
// already there stays put and only the new ones come in. Once the turn ends it is plain text again.
function StreamingParagraph({ tokens }: { tokens: Token[] | undefined }) {
    const ink = useInk()
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {wordsOf(tokens, {}).map((word, i) =>
                word.text === '\n' ? (
                    <View key={i} style={{ width: '100%' }} />
                ) : (
                    <Animated.View key={i} entering={WORD_ENTERING}>
                        <AppText variant="body" style={[{ color: ink.text }, word.style]}>
                            {word.text}
                        </AppText>
                    </Animated.View>
                )
            )}
        </View>
    )
}

// An image sits on its own line: a phone cannot float one inside a run of text.
function ParagraphWithImages({ tokens, streaming }: { tokens: Token[]; streaming: boolean }) {
    const { owner } = use(Scope)
    const pieces: ({ kind: 'text'; tokens: Token[] } | { kind: 'image'; token: Tokens.Image })[] = []
    for (const token of tokens) {
        if (token.type === 'image') pieces.push({ kind: 'image', token: token as Tokens.Image })
        else {
            const last = pieces.at(-1)
            if (last?.kind === 'text') last.tokens.push(token)
            else pieces.push({ kind: 'text', tokens: [token] })
        }
    }
    return (
        <View style={{ gap: spacing.sm }}>
            {pieces.map((piece, i) => {
                if (piece.kind === 'image') return <MarkdownImage key={i} url={fileUrlOf(owner, piece.token.href)} alt={piece.token.text} />
                if (piece.tokens.every(token => token.type === 'text' && !token.text.trim())) return null
                return streaming && i === pieces.length - 1 ? <StreamingParagraph key={i} tokens={piece.tokens} /> : <Paragraph key={i} tokens={piece.tokens} />
            })}
        </View>
    )
}

function ListBlock({ token, streaming }: { token: Tokens.List; streaming: boolean }) {
    const ink = useInk()
    const start = typeof token.start === 'number' ? token.start : 1
    return (
        <View style={{ gap: spacing.xs }}>
            {token.items.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: spacing.sm }}>
                    {item.task ? (
                        <View style={{ height: 24, justifyContent: 'center' }}>
                            <Icon name={item.checked ? 'square-check-fill' : 'square'} size={16} color={item.checked ? ink.text : ink.muted} />
                        </View>
                    ) : (
                        <AppText variant="body" style={{ color: ink.text, minWidth: token.ordered ? 18 : 10, fontVariant: ['tabular-nums'] }}>
                            {token.ordered ? `${start + i}.` : '•'}
                        </AppText>
                    )}
                    <View style={{ flexShrink: 1, gap: spacing.xs }}>
                        <Blocks tokens={item.tokens.filter(child => child.type !== 'checkbox')} streaming={streaming && i === token.items.length - 1} />
                    </View>
                </View>
            ))}
        </View>
    )
}

function Blockquote({ token, streaming }: { token: Tokens.Blockquote; streaming: boolean }) {
    const ink = useInk()
    const scope = use(Scope)
    return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: ink.faint, paddingLeft: spacing.md }}>
            <Scope value={{ ...scope, muted: true }}>
                <Blocks tokens={token.tokens} streaming={streaming} />
            </Scope>
        </View>
    )
}

function Block({ token, first, streaming }: { token: Token; first: boolean; streaming: boolean }) {
    const ink = useInk()
    switch (token.type) {
        case 'heading': {
            const heading = token as Tokens.Heading
            return <Paragraph tokens={heading.tokens} style={{ ...(HEADINGS[heading.depth] ?? SMALL_HEADING), fontFamily: fonts.semibold, marginTop: first ? 0 : spacing.xs }} />
        }
        case 'paragraph': {
            const paragraph = token as Tokens.Paragraph
            if (/^\s*\$\$/.test(paragraph.raw)) return <CodeBlock code={paragraph.raw.trim().replace(/^\$\$|\$\$$/g, '').trim()} language="math" />
            if (paragraph.tokens.some(child => child.type === 'image')) return <ParagraphWithImages tokens={paragraph.tokens} streaming={streaming} />
            return streaming ? <StreamingParagraph tokens={paragraph.tokens} /> : <Paragraph tokens={paragraph.tokens} />
        }
        case 'text': {
            const text = token as Tokens.Text
            const tokens = text.tokens ?? [{ type: 'text', raw: text.raw, text: text.text } as Tokens.Text]
            if (tokens.some(child => child.type === 'image')) return <ParagraphWithImages tokens={tokens} streaming={streaming} />
            return streaming ? <StreamingParagraph tokens={tokens} /> : <Paragraph tokens={tokens} />
        }
        case 'code': {
            const code = token as Tokens.Code
            const [language = '', ...meta] = (code.lang ?? '').trim().split(/\s+/)
            if (language === 'draft') return <DraftBlock code={code.text} title={meta.join(' ')} />
            return <CodeBlock code={code.text} language={language} />
        }
        case 'list':
            return <ListBlock token={token as Tokens.List} streaming={streaming} />
        case 'blockquote':
            return <Blockquote token={token as Tokens.Blockquote} streaming={streaming} />
        case 'table':
            return <MarkdownTable token={token as Tokens.Table} renderCell={cell => renderInline(cell.tokens)} />
        case 'hr':
            return <View style={{ height: 1, backgroundColor: ink.faint, marginVertical: spacing.sm }} />
        case 'html': {
            const text = token.text.replace(/<[^>]+>/g, '').trim()
            return text ? <Paragraph tokens={[{ type: 'text', raw: text, text } as Tokens.Text]} /> : null
        }
        default:
            return null
    }
}

function Blocks({ tokens, streaming }: { tokens: Token[]; streaming: boolean }) {
    const shown = tokens.filter(token => token.type !== 'space' && token.type !== 'def')
    return shown.map((token, i) => <Block key={i} token={token} first={i === 0} streaming={streaming && i === shown.length - 1} />)
}

type MarkdownProps = {
    text: string
    // Animates the words of the last paragraph as they arrive, the one a running turn still writes.
    streaming?: boolean
    surface?: MarkdownSurface
    // Whose files a relative image or a workspace link points at.
    owner?: FileOwner | null
    // Bare URLs read as their short label, as they did in the composer.
    shortLinks?: boolean
}

/**
 * The markdown of the web's chat (Streamdown with GFM), drawn natively: headings, lists and task
 * lists, quotes, tables, code with highlighting, drafts, links, images, and `$$` math shown as its
 * source. A half-written answer is closed first, the way Streamdown's `remend` does, so an open `**`
 * or fence never shows raw.
 */
export function Markdown({ text, streaming = false, surface = 'page', owner = null, shortLinks = false }: MarkdownProps) {
    const tokens = useMemo(() => Lexer.lex(remend(text), { gfm: true }), [text])
    const scope = useMemo(() => ({ surface, owner, shortLinks, muted: false }), [surface, owner, shortLinks])
    return (
        <Scope value={scope}>
            <View style={{ gap: spacing.md }}>
                <Blocks tokens={tokens} streaming={streaming} />
            </View>
        </Scope>
    )
}
