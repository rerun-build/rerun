import { CLAUDE_PATH, OPENAI_PATH } from '@/lib/engine/provider-icons'

function inlineMark(svg: string) {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export const CLAUDE_MARK = inlineMark(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#D97757"><path d="${CLAUDE_PATH}"/></svg>`
)

export const CHATGPT_MARK = inlineMark(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff"><path d="${OPENAI_PATH}"/></svg>`
)

export const OPENROUTER_MARK = inlineMark(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff"><path d="M18.654 3.521c2.81 0 5.087 2.278 5.087 5.087s-2.278 5.087 -5.087 5.087l5.046 5.046c0.641 0.641 0.187 1.737 -0.719 1.737h-14.502c-4.683 0 -8.479 -3.796 -8.479 -8.479S3.796 3.521 8.479 3.521h10.175ZM8.479 6.913c-2.81 0 -5.087 2.278 -5.087 5.087s2.278 5.087 5.087 5.087 5.087 -2.278 5.087 -5.087 -2.278 -5.087 -5.087 -5.087Z"/></svg>'
)
