// How the viewer draws a file that is not a photo: `page` loads it in the web view, `text` reads it and
// shows it as plain text, `none` sends it to another app through the share sheet.
export type FilePreview = 'page' | 'text' | 'none'

// iOS's web view draws PDFs, text, spreadsheets and office documents.
export function filePreviewOf(_name: string): FilePreview {
    return 'page'
}
