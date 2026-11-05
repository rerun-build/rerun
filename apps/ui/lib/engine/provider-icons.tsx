// Inline brand SVG logos for the model-selector providers and the MCP clients we tell people how
// to connect.
//
// Kept dependency-free (no icon library): one small component per provider, plus a
// <ProviderIcon> dispatcher keyed by the catalog `provider` id (see models.ts).
// Anthropic and Google keep their brand colors; OpenAI and OpenRouter use
// `currentColor` so their near-black marks stay visible in both light and dark themes.

import type { JSX } from 'react'
import { R_PATH } from '@/components/layout/Logo'
import { ServerIcon } from '@/lib/icons'

type IconProps = { className?: string }

// Shared with the offer board, which inlines the same marks as data URLs for its tiles.
export const CLAUDE_PATH = 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
export const OPENAI_PATH = 'M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z'

function RerunIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 512 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path fillRule="evenodd" d={R_PATH} />
        </svg>
    )
}

function AnthropicIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="#D97757" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767l6.57 16.96H13.34l-1.343-3.461H5.143l-1.342 3.46H0l6.57-16.96zm4.428 10.234L8.736 7.928l-2.262 5.826h4.523z" />
        </svg>
    )
}

// The subscription and the API are two different marks: `claude` is the plan people chat with and
// wears the Claude burst, `anthropic` is the developer console and keeps the Anthropic wordmark.
function ClaudeIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="#D97757" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d={CLAUDE_PATH} />
        </svg>
    )
}

function OpenAIIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d={OPENAI_PATH} />
        </svg>
    )
}

function GoogleIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
        </svg>
    )
}

function AppleIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
        </svg>
    )
}

function OpenRouterIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M18.654 3.521c2.81 0 5.087 2.278 5.087 5.087s-2.278 5.087 -5.087 5.087l5.046 5.046c0.641 0.641 0.187 1.737 -0.719 1.737h-14.502c-4.683 0 -8.479 -3.796 -8.479 -8.479S3.796 3.521 8.479 3.521h10.175ZM8.479 6.913c-2.81 0 -5.087 2.278 -5.087 5.087s2.278 5.087 5.087 5.087 5.087 -2.278 5.087 -5.087 -2.278 -5.087 -5.087 -5.087Z" />
        </svg>
    )
}

// Shared with the offer board, which inlines the same mark as a data URL for its tile.
export const OPENCODE_FRAME_PATH = 'M384 416H128V96H384V416ZM320 160H192V352H320V160Z'
export const OPENCODE_CORE_PATH = 'M320 224V352H192V224H320Z'

// OpenCode's own mark is white on near-black; `currentColor` keeps it readable in both themes.
function OpenCodeIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="80 80 352 352" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d={OPENCODE_CORE_PATH} opacity={0.4} />
            <path fillRule="evenodd" clipRule="evenodd" d={OPENCODE_FRAME_PATH} />
        </svg>
    )
}

function CursorIcon({ className = 'size-3.5' }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
        </svg>
    )
}

const PROVIDER_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
    rerun: RerunIcon,
    anthropic: AnthropicIcon,
    claude: ClaudeIcon,
    openai: OpenAIIcon,
    codex: OpenAIIcon,
    cursor: CursorIcon,
    google: GoogleIcon,
    apple: AppleIcon,
    openrouter: OpenRouterIcon,
    opencode: OpenCodeIcon,
}

// Brand logo for a catalog provider id. A provider with no logo of its own — a user's own
// OpenRouter-compatible router, say — falls back to a generic server mark rather than a hole in the
// layout. No provider at all still renders nothing.
export function ProviderIcon({ provider, className = 'size-3.5' }: { provider?: string | null; className?: string }) {
    if (!provider) return null
    const Icon = PROVIDER_ICONS[provider] ?? ServerIcon
    return <Icon className={className} />
}
