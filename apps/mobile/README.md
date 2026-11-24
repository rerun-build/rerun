# rerun-mobile (apps/mobile)

The Rerun app for iPhone, iPad and Android, built with Expo and Expo Router. It talks to a hub
(`apps/ui`) through its `/api/v1` routes and signs in with Supabase, like the web app. It shares
`@rerun/contracts`, `@rerun/db` (types only) and `@rerun/i18n` with the rest of the monorepo.

## Run it

From the root of the monorepo, on a Mac with Xcode (and the Android SDK for `--android`):

```bash
pnpm dev:mobile                  # the iOS simulator
pnpm dev:mobile --device         # the paired iPhone, signed with the Apple ID added in Xcode (a free one works)
pnpm dev:mobile --android        # an Android emulator
pnpm dev:mobile --rebuild        # force the native build instead of reusing a cached dev client
```

The script builds a development client (cached by its native inputs: `package.json`, `app.json`,
`app.config.ts`), starts Metro, and starts the hub of this checkout on port 3050 (or `CONDUCTOR_PORT`)
unless it already answers there. Metro takes the hub port + 2. Details at the top of
`scripts/dev-mobile.mjs` and `scripts/dev-mobile-android.mjs`.

## Talking to the hub

Every call to the hub is an entry of `mobileApi` (`@rerun/contracts`): `hub(mobileApi.getAgent, { ...caller,
params: { id } })` in `src/api/client.ts` sends its method and path and reads the answer with the schema the
hub promised; streams and files build their address with `hubPath(mobileApi.x, …)`. A path written by hand
fails `src/api/hub-paths.test.ts`.

An answer the build cannot fully read is not dropped whole (`src/api/salvage.ts`): a value it does not know
(a new enum value, a new kind of part) empties an optional field or leaves out the item of a list it sits
in, the rest is read, and PostHog gets `api_answer_salvaged`, once per call for as long as the app runs.
Only answers: what the app sends is never bent.

What each build in the stores reads is frozen in `api-contract/`: see its README before changing a call.

## Which server the app talks to

`apps/mobile/.env` (from `.env.example`) holds the Supabase pair the app signs in with,
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Set `EXPO_PUBLIC_API_URL` there to
use a deployed hub: `pnpm dev:mobile` then starts no local hub.

At launch, `src/config/environment.ts` picks the server:

- a server the person picked in the app (**Use your own server** on the sign-in screen) comes first;
- otherwise a store build follows its update channel, `production` or `staging`;
- otherwise (a development build) the `EXPO_PUBLIC_*` values.

A self-hosted install needs nothing in the build: people type its address in the app. See
`apps/docs/self-host/mobile.mdx`.

## Build profiles

`eas.json` defines the EAS builds:

| Profile | What it builds |
| --- | --- |
| `development` | a development client: iOS simulator, Android APK installed beside the store app as `build.rerun.app.dev` |
| `simulator-lab` | the development client on the `preview` EAS environment |
| `staging` | a store build on the `staging` channel |
| `production` | a store build on the `production` channel |

## Open source and Rerun Cloud

Like the web app, what Rerun Cloud runs differently is imported from `@rerun/cloud-mobile/<module>`.
Without the private `cloud/` folder it resolves to `src/cloud-oss/` (`paths` in `tsconfig.json`,
`jest.resolver.js` for the tests). A fork builds with its own EAS project (`EXPO_OWNER`,
`EAS_PROJECT_ID`), and a `staging` or `production` build without `cloud/` fails unless its EAS
environment sets `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`app.config.ts`).

## Scripts

Run from `apps/mobile`, or from the root with `pnpm --filter rerun-mobile <script>`:

| Script | What it does |
| --- | --- |
| `start` | `expo start` (Metro alone) |
| `ios` | `expo run:ios` |
| `test` | Jest, every test run once as iOS and once as Android |
| `lint` | `expo lint` |
| `ts-check` | `tsc --noEmit` |

End-to-end flows (Maestro) live in `.maestro/`, with their own README.

## Measuring smoothness

- `src/perf/chat-renders.test.tsx` opens a conversation of 200 messages and counts what typing,
  scrolling and a streamed reply redraw. Its budgets fail a change that makes the chat redraw more.
- The **Perf, 200 messages** lab (`/lab-perf`, development builds) lays the same conversation out on
  the device, with buttons that type, stream and scroll for a few seconds and report what redrew.
- `EXPO_PUBLIC_PERF=1 pnpm dev:mobile` prints in Metro's log how long a conversation took to open from
  the Home, on the copy kept on the phone and then on the hub's, and every second that missed frames
  on the JavaScript or the UI thread. A counter in the corner shows the same frames on screen.
- `EXPO_PUBLIC_START_ROUTE=/lab-chat?tabs=3&cycle=1` opens a development build on that route, for a
  remote simulator to reach a lab without a tap (`cycle=1` moves the chat lab to its next page every
  few seconds).

## Rules

`AGENTS.md` in this folder: the app is on Expo SDK 58, read the versioned Expo docs before writing
code. The strings go through `@rerun/i18n` (`src/i18n/`), and the languages the system settings offer
are `APP_LANGUAGES` in `app.config.ts`. Arabic and Hebrew lay the app out right to left: when the
language changes direction, `I18nProvider` sets `I18nManager` and restarts the app once.
