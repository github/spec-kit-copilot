import { isDeepStrictEqual } from "node:util";

export { validControlContract, validControlValue } from "../external-control-contract.mjs";

export function validateDesignerAdapterExports(adapter, control) {
    if (adapter.controlId !== control.id
        || !isDeepStrictEqual(adapter.valueContract, control.value)
        || typeof adapter.validate !== "function") {
        throw new Error("incompatible Designer adapter exports");
    }
}
