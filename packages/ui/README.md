# @rerun/ui

The design system of Rerun and the React components more than one app draws: the primitives (`Badge`,
buttons, cards, tabs, skeletons), the theme and its tokens (`src/theme.css`, `src/theme/`), the
isometric board (`iso-grid`), the chat, the inbox, the forms, the stepper (`steps`), the tour, the
template story, the brand icon and the logo. Each folder is its own entry point, listed in the
`exports` of `package.json` (`@rerun/ui/primitives`, `@rerun/ui/iso-grid`, `@rerun/ui/chat`...).

## Who imports it

`apps/ui` and the renderer of `apps/desktop-app`. It ships its TypeScript sources, not a build, so
each app compiles it:

- Next lists it in `transpilePackages` (`apps/ui/next.config.ts`);
- the app's stylesheet imports `packages/ui/src/styles.css` by a relative path and adds
  `@source "<path>/packages/ui/src"`, so Tailwind sees the classes the components use
  (`apps/ui/app/globals.css`, `apps/desktop-app/src/renderer/src/styles.css`).

React, Next, Radix, motion and the other libraries it relies on are peer dependencies, taken from the
app.

## Check it

```bash
pnpm --filter @rerun/ui ts-check
```

It has no tests and no dev server of its own: a change is seen in the app that renders it.

## Rules

- A string a person sees goes through `useKitTranslations()` (the `kit` namespace of
  `packages/i18n/messages/en/kit.json`), and a date or a number is formatted with `useUiLocale()`.
  The package never imports next-intl: the app hands its locale and pack down through
  `UiLocaleProvider` (`@rerun/ui/locale`).
- An import path works only once it has its line in the `exports` of `package.json`.
