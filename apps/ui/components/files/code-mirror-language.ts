import type { LanguageSupport } from '@codemirror/language'

import { fileExtension } from '@/lib/files/preview'

const LOADERS: Record<string, () => Promise<LanguageSupport>> = {
    json: () => import('@codemirror/lang-json').then(m => m.json()),
    md: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
    markdown: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
    mdx: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
    yml: () => import('@codemirror/lang-yaml').then(m => m.yaml()),
    yaml: () => import('@codemirror/lang-yaml').then(m => m.yaml()),
    py: () => import('@codemirror/lang-python').then(m => m.python()),
    html: () => import('@codemirror/lang-html').then(m => m.html()),
    htm: () => import('@codemirror/lang-html').then(m => m.html()),
    css: () => import('@codemirror/lang-css').then(m => m.css()),
    scss: () => import('@codemirror/lang-css').then(m => m.css()),
    js: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
    mjs: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
    cjs: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
    jsx: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })),
    ts: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
    tsx: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: true })),
}

export async function loadLanguage(fileName: string): Promise<LanguageSupport | null> {
    const loader = LOADERS[fileExtension(fileName)]
    return loader ? loader() : null
}
