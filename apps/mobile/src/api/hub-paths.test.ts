// Jest runs these tests in Node, but the app's TypeScript program has no Node types: the two modules
// this test reads the sources with are declared here.
declare const require: (id: 'node:fs' | 'node:path') => {
    readdirSync(path: string, options: { recursive: true; encoding: 'utf8' }): string[]
    readFileSync(path: string, encoding: 'utf8'): string
    join(...parts: string[]): string
}
declare const __dirname: string

const { readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const SRC = join(__dirname, '..')

// Every call to the hub goes through the registry of @rerun/contracts (`hub(mobileApi.x, …)`,
// `hubPath(mobileApi.x, …)`): a path typed by hand is a call the contract does not know, and the hub
// could break it without a test noticing.
describe('the calls of the app to the hub', () => {
    it('name no path by hand', () => {
        const typed = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
            .filter(file => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
            .flatMap(file =>
                readFileSync(join(SRC, file), 'utf8')
                    .split('\n')
                    .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
                    .filter(({ text }) => !text.startsWith('//') && /['"`]\/api\//.test(text))
                    .map(({ file, line, text }) => `${file}:${line} ${text}`)
            )
        expect(typed).toEqual([])
    })
})
