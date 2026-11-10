const ESCAPED: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

// A text file as the web view shows plain text: wrapped, at the width of the screen.
export function textPageHtml(text: string): string {
    const body = text.replace(/[&<>]/g, character => ESCAPED[character])
    return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin:16px;font:13px/1.5 monospace">${body}</pre>`
}
