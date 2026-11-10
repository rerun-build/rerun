export function slugify(input: string, options: { maxLength?: number } = {}): string {
    const slug = input
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return options.maxLength === undefined ? slug : slug.slice(0, options.maxLength).replace(/-+$/, '')
}
