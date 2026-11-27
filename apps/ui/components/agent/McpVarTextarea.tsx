'use client'

import { McpVariableToken } from '@/components/agent/McpVariableToken'
import { Field } from '@/components/ui/field'
import { TextareaMirror } from '@/components/ui/textarea-mirror'
import type { AgentVariables } from '@/hooks/useAgentVariables'
import { cn } from '@/lib/utils'
import { MCP_PLACEHOLDER } from '@rerun/contracts'
import { useId, useMemo, type ClipboardEvent } from 'react'

// Typography and box metrics have to be byte-identical between the textarea and the mirror layered
// on top of it, otherwise the highlights drift away from the characters they mark.
const METRICS = 'px-2.5 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words'

type Segment = { kind: 'text'; text: string } | { kind: 'var'; name: string; text: string }

function tokenize(value: string): Segment[] {
    const segments: Segment[] = []
    let cursor = 0
    for (const match of value.matchAll(MCP_PLACEHOLDER)) {
        if (match.index > cursor) segments.push({ kind: 'text', text: value.slice(cursor, match.index) })
        segments.push({ kind: 'var', name: match[2], text: match[0] })
        cursor = match.index + match[0].length
    }
    segments.push({ kind: 'text', text: value.slice(cursor) })
    return segments
}

type McpVarTextareaProps = {
    label: string
    helperText?: string
    warning?: string | null
    value: string
    onChange: (value: string) => void
    placeholder: string
    vars: AgentVariables
    minHeightClassName?: string
    singleLine?: boolean
    disabled?: boolean
    className?: string
    onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
}

// A URL field stays a textarea that wraps rather than an input that scrolls horizontally: the
// mirror is pinned to the box, so a scrolled input would slide its highlights off the characters.
export function McpVarTextarea({ label, helperText, warning, value, onChange, placeholder, vars, minHeightClassName = 'min-h-16', singleLine, disabled, className, onPaste }: McpVarTextareaProps) {
    const id = useId()
    const segments = useMemo(() => tokenize(value), [value])

    return (
        <Field label={label} helperText={helperText} htmlFor={id}>
            <div className={cn('relative rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30', className)}>
                <textarea
                    id={id}
                    value={value}
                    onChange={e => onChange(singleLine ? e.target.value.replace(/\s+/g, '') : e.target.value)}
                    onKeyDown={e => {
                        if (singleLine && e.key === 'Enter') e.preventDefault()
                    }}
                    onPaste={onPaste}
                    placeholder={placeholder}
                    spellCheck={false}
                    disabled={disabled}
                    className={`${METRICS} field-sizing-content ${minHeightClassName} w-full resize-none bg-transparent text-transparent caret-foreground outline-none selection:bg-foreground/25 placeholder:text-muted-foreground`}
                />
                <TextareaMirror className={`${METRICS} ${disabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {segments.map((segment, index) =>
                        segment.kind === 'text' || disabled ? (
                            <span key={index} aria-hidden>
                                {segment.kind === 'text' ? segment.text : `\${${segment.name}}`}
                            </span>
                        ) : (
                            <McpVariableToken key={index} name={segment.name} text={segment.text} vars={vars} />
                        ),
                    )}
                </TextareaMirror>
            </div>
            {warning && <p className="text-xs text-orange-600 dark:text-orange-400">{warning}</p>}
        </Field>
    )
}
