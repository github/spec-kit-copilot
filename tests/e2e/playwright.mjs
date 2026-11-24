import { createRequire } from "node:module";

const require = createRequire(new URL(
    "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/package.json",
    import.meta.url,
));

export const { test, expect } = require("@playwright/test");
