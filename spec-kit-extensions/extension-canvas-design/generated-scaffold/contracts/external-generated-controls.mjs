const imageContract = { type: "image", maxBytes: 32768,
    mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };

export function validateStockTextAdapter(controlId, valueContract, mount) {
    if (controlId !== "stock.text" || JSON.stringify(valueContract) !== '{"type":"string"}'
        || typeof mount !== "function") throw new Error("Incompatible stock.text adapter");
}

export function validateGeneratedControl(mount, controlId, valueContract, root) {
    if (typeof mount !== "function") throw new Error("Missing mount export");
    const expected = JSON.parse(root.dataset.contract);
    if (controlId !== root.dataset.controlType || valueContract?.type !== expected.type
        || JSON.stringify(Object.entries(valueContract.properties ?? {}).sort())
            !== JSON.stringify(Object.entries(expected.properties).sort())) {
        throw new Error("Incompatible control ID or value contract");
    }
}

export function validatePlacedControl(mount, controlId, valueContract, placement, state) {
    if (typeof mount !== "function" || controlId !== placement.control
        || valueContract?.type !== state.schema?.type
        || (state.schema?.type === "object" && JSON.stringify(Object.entries(valueContract.properties ?? {}).sort())
            !== JSON.stringify(Object.entries(state.schema.properties ?? {}).sort()))) {
        throw new Error(`Incompatible generated adapter for ${placement.field}`);
    }
}

export function validatePageRenderer(renderPage, id) {
    if (typeof renderPage !== "function") throw new Error(`Invalid renderer for ${id}`);
}

export function validateStockImageAdapter(controlId, mount, valueContract) {
    if (controlId !== "stock.image" || typeof mount !== "function"
        || !valueContract || typeof valueContract !== "object"
        || JSON.stringify(Object.entries(valueContract).sort())
            !== JSON.stringify(Object.entries(imageContract).sort())) {
        throw new Error("Incompatible stock.image adapter");
    }
}
