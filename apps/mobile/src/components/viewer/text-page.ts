const ESCAPED: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

export function textPageHtml(text: string): string {
    const body = text.replace(/[&<>]/g, character => ESCAPED[character])
    return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin:16px;font:13px/1.5 monospace">${body}</pre>`
}
