import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { defineConfig } from "@trigger.dev/sdk/v3";

const CONTRACTS_SOURCE_ENTRY = fileURLToPath(
  new URL("../../packages/contracts/src/index.ts", import.meta.url),
);
const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const EXTERNAL_PACKAGES = ["sharp", "apify-client", "ssh2"];
const CLOUD_DIR = fileURLToPath(new URL("../../cloud/", import.meta.url));

const CLOUD_PROJECT_FILE = `${CLOUD_DIR}packages/cloud/trigger-project.json`;
const PROJECT_REF =
  process.env.TRIGGER_PROJECT_REF ??
  (existsSync(CLOUD_PROJECT_FILE) ? (JSON.parse(readFileSync(CLOUD_PROJECT_FILE, "utf8")) as { project: string }).project : "");

export default defineConfig({
  project: PROJECT_REF,
  runtime: "node-22",
  logLevel: "log",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./trigger"],
  build: {
    external: EXTERNAL_PACKAGES,
    extensions: [
      esbuildPlugin({
        name: "rerun-contracts-from-source",
        setup(build) {
          build.onResolve({ filter: /^@rerun\/contracts$/ }, () => ({ path: CONTRACTS_SOURCE_ENTRY }));
        },
      }),
      esbuildPlugin({
        name: "rerun-cloud-packages-from-the-app",
        setup(build) {
          build.onResolve({ filter: /^[^./]/ }, (args) => {
            if (!args.importer.startsWith(CLOUD_DIR) || args.pluginData?.fromApp) return undefined;
            if (/^(node:|@\/|@rerun\/(contracts|cloud)(\/|$))/.test(args.path)) return undefined;
            if (EXTERNAL_PACKAGES.some((name) => args.path === name || args.path.startsWith(`${name}/`))) return undefined;
            return build.resolve(args.path, { kind: args.kind, resolveDir: APP_DIR, pluginData: { fromApp: true } });
          });
        },
      }),
    ],
  },
});
