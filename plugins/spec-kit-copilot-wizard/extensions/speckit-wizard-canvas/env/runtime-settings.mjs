import { resolveRuntimeConfig } from "./runtime-config.mjs";

// Load once per provider process; reloading the provider applies configuration edits.
export const runtimeConfig = await resolveRuntimeConfig();
export const runtimeSettings = runtimeConfig.settings;
