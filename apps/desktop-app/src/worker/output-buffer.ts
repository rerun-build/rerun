// What a command prints, kept within a budget: the first lines (what it set out to do, the error
// that stopped it early) and the last ones (where it ended). The middle of a 1 GB log is dropped as
// it streams, so memory stays flat whatever the command prints.
export class OutputBuffer {
    private head = ''
    private tail = ''
    private dropped = 0
    private readonly decoder = new TextDecoder('utf-8')

    constructor(
        private readonly headChars = 20_000,
        private readonly tailChars = 80_000,
    ) {}

    push(chunk: Uint8Array): void {
        this.append(this.decoder.decode(chunk, { stream: true }))
    }

    private append(text: string): void {
        if (!text) return
        if (this.head.length < this.headChars) {
            const room = this.headChars - this.head.length
            this.head += text.slice(0, room)
            text = text.slice(room)
        }
        if (!text) return
        this.tail += text
        if (this.tail.length > this.tailChars * 2) this.trimTail()
    }

    private trimTail(): void {
        const over = this.tail.length - this.tailChars
        if (over <= 0) return
        this.dropped += over
        this.tail = this.tail.slice(over)
    }

    get truncated(): boolean {
        this.trimTail()
        return this.dropped > 0
    }

    text(): string {
        this.append(this.decoder.decode())
        this.trimTail()
        if (this.dropped === 0) return this.head + this.tail
        return `${this.head}\n[… ${this.dropped} characters left out …]\n${this.tail}`
    }
}
