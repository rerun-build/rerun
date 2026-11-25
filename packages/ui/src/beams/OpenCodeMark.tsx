const OPENCODE_FRAME_PATH = 'M384 416H128V96H384V416ZM320 160H192V352H320V160Z'
const OPENCODE_CORE_PATH = 'M320 224V352H192V224H320Z'

// OpenCode's own mark is white on near-black; `currentColor` keeps it readable in both themes.
export function OpenCodeMark({ className = 'size-3.5' }: { className?: string }) {
    return (
        <svg className={className} viewBox="80 80 352 352" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d={OPENCODE_CORE_PATH} opacity={0.4} />
            <path fillRule="evenodd" clipRule="evenodd" d={OPENCODE_FRAME_PATH} />
        </svg>
    )
}
