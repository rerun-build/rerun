---
name: i18n-strings
description: Put every user-facing string of Rerun through the language packs (next-intl, ICU, packages/i18n) and keep the French and Spanish packs in step. Use whenever you add or change visible text in apps/ui or packages/ui (a label, a button, a toast, an error, an empty state, a zod message), format a date or a number for the screen, extract an existing screen into a namespace, or add a language. Triggers: "translate", "i18n", "add a string", "language pack", « traduis », « ajoute une langue ».
---

# Strings through the language packs

Reply in the user's language. The code, the keys and the English source stay in English.

## 1. Pick the namespace

One namespace per feature, matching the folders of `apps/ui/components` (`chat`, `agent`, `billing`,
`account`, `workspace`, ...). It is a file: `packages/i18n/messages/en/<namespace>.json`. A new file is
picked up by `pnpm i18n:translate`, which regenerates `messages/<locale>/index.ts`.

## 2. Write the key in English

```json
{
    "_context": { "composer.placeholder": "Empty chat input, before the first message." },
    "composer": {
        "placeholder": "Ask {name} anything",
        "files": "{count, plural, one {# file} other {# files}}"
    }
}
```

- The key names the role of the string (`composer.placeholder`), never its words.
- A whole sentence is one key. Never `t('a') + name + t('b')`: the word order changes between languages.
- Rich text uses tags: `"Read the <link>docs</link>"` with `t.rich('key', { link: chunks => <a>{chunks}</a> })`.
- `_context` explains an ambiguous string to the translator (a button vs a title, what a variable holds).
- No em dash, ever, in any language.

## 3. Use it

```tsx
const t = useTranslations('chat')            // client component
const t = await getTranslations('chat')      // server component, server action, route
t('composer.placeholder', { name })
```

- Toasts: `toast.success(t('saved'))`.
- Zod in a client form: build the schema inside the component (or a function taking `t`) so its messages
  come from `t()`.
- Keys are typed from the English source: a missing key fails `pnpm typecheck`.
- packages/ui never imports next-intl: a shared component takes its strings as props, and formats with
  `useUiLocale()`.

## 4. Dates and numbers

`@rerun/i18n/format` (`shortRelativeTime`, `messageDayLabel`, `shortDate`, `formatNumber`,
`formatDate`, `formatBytes`, ...) with `useLocale()`. Its English output is the one the app always had.

## 5. Translate and check

```bash
pnpm i18n:translate --ns chat --dry-run   # what it will translate and the estimated cost
pnpm i18n:translate --ns chat             # Claude writes fr and es, checks placeholders, length, glossary
pnpm i18n:check                           # must be green before the pull request
```

Read the generated `fr/*.json` and `es/*.json` in the diff. Fix a wrong word by hand in the pack, then
`pnpm i18n:translate --accept`. Terms that must not move go in `packages/i18n/glossary.json`.

## 6. See it

`pnpm verify:ui --locale fr` (then `es`, then `en-XA`, the pseudo-locale that stretches every string
by a third and accents it: an English string left in the code shows up unaccented). Look at every
width: French and Spanish run longer than English.

The language picker (Account → Language) only shows while the `i18n` flag is open for you
(`I18N_RELEASED` in `apps/ui/lib/features.ts`, admins and early access before that).
