import { asRecord } from '@rerun/contracts'
import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai'

function canonicalBox(box: unknown, names: readonly string[]): string {
    return (typeof box === 'string' && names.find(name => name.toLowerCase() === box.trim().toLowerCase())) || names[0]
}

export function pinPlanBoxes(input: unknown, names: readonly string[]): Record<string, unknown> {
    const args = asRecord(input)
    const items = Array.isArray(args.items) ? args.items.map(item => ({ ...asRecord(item), box: canonicalBox(asRecord(item).box, names) })) : []
    return { ...args, boxes: names.map(name => ({ name })), items }
}

export function pinTemplateBoxes(input: unknown, names: readonly string[]): Record<string, unknown> {
    const args = asRecord(input)
    return { ...args, box: canonicalBox(args.box, names), boxes: names.map(name => ({ name })) }
}

const PINNERS: Record<string, (input: unknown, names: readonly string[]) => Record<string, unknown>> = { show_plan: pinPlanBoxes, show_templates: pinTemplateBoxes }

export function pinPlanBoxesTransform<TOOLS extends ToolSet>(names: readonly string[]): StreamTextTransform<TOOLS> {
    return () =>
        new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
            transform(part, controller) {
                const pin = part.type === 'tool-call' ? PINNERS[part.toolName] : undefined
                controller.enqueue(pin && part.type === 'tool-call' ? ({ ...part, input: pin(part.input, names) } as TextStreamPart<TOOLS>) : part)
            },
        })
}
