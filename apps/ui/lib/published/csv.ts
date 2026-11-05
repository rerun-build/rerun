export type CsvDelimiter = ',' | ';' | '\t'

const CANDIDATES: readonly CsvDelimiter[] = [',', ';', '\t']

// The delimiter that splits the first line into the most cells, quotes respected. A European export
// separates with `;`, a spreadsheet copy with tabs; a comma wins every tie.
export function sniffDelimiter(text: string): CsvDelimiter {
    const firstLine = firstRecord(text)
    let best: CsvDelimiter = ','
    let bestCount = 0
    for (const delimiter of CANDIDATES) {
        let count = 0
        let quoted = false
        for (const char of firstLine) {
            if (char === '"') quoted = !quoted
            else if (!quoted && char === delimiter) count++
        }
        if (count > bestCount) {
            best = delimiter
            bestCount = count
        }
    }
    return best
}

function firstRecord(text: string): string {
    let quoted = false
    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (char === '"') quoted = !quoted
        else if (!quoted && (char === '\n' || char === '\r')) return text.slice(0, i)
    }
    return text
}

export type ParsedCsv = { rows: string[][]; truncated: boolean }

// RFC 4180: a quoted field may hold the delimiter, line breaks and doubled quotes; records end at
// LF, CRLF or a lone CR. Parsing stops once `maxRows` records are read, header included.
export function parseCsv(input: string, { delimiter, maxRows = Infinity }: { delimiter?: CsvDelimiter; maxRows?: number } = {}): ParsedCsv {
    const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
    const sep = delimiter ?? sniffDelimiter(text)
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false
    let i = 0

    const endRecord = () => {
        row.push(field)
        field = ''
        rows.push(row)
        row = []
    }

    while (i < text.length) {
        const char = text[i]
        if (quoted) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"'
                    i += 2
                    continue
                }
                quoted = false
            } else {
                field += char
            }
            i++
            continue
        }
        if (char === '"' && field === '') {
            quoted = true
        } else if (char === sep) {
            row.push(field)
            field = ''
        } else if (char === '\n' || char === '\r') {
            endRecord()
            if (char === '\r' && text[i + 1] === '\n') i++
            if (rows.length >= maxRows) return { rows, truncated: i + 1 < text.length }
        } else {
            field += char
        }
        i++
    }
    if (field !== '' || row.length > 0) endRecord()
    return { rows, truncated: false }
}

const NUMERIC = /^[-+]?[$€£¥]?\s?[-+]?(\d{1,3}([ ,.  ]\d{3})*|\d+)([.,]\d+)?\s?(%|[$€£¥]|[kKmMbB])?$/

export function isNumericCell(cell: string): boolean {
    const value = cell.trim()
    return value !== '' && NUMERIC.test(value)
}

// A column reads as numeric when every non-empty cell under the header does.
export function numericColumns(rows: readonly (readonly string[])[]): boolean[] {
    const width = Math.max(0, ...rows.map(row => row.length))
    return Array.from({ length: width }, (_, column) => {
        const cells = rows.map(row => row[column] ?? '').filter(cell => cell.trim() !== '')
        return cells.length > 0 && cells.every(isNumericCell)
    })
}
