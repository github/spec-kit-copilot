import { renameSync } from "node:fs";

// Preparation stays asynchronous. Only this final swap is synchronous, so
// lifecycle replacement cannot interleave between its owner check and commit.
export function commitOwnedFile(temp, target, assertCurrent, publish) {
    assertCurrent();
    renameSync(temp, target);
    publish();
}
