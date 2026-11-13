// The title a session row is created under. The hub replaces it with a generated one only while the
// row still carries it: a title that differs was chosen by a person.
export function seedSessionTitle(text: string | null | undefined): string {
    return text?.slice(0, 50) || 'New conversation'
}
