const { validateStockImageAdapter } = await import(
    `../contracts/external-generated-controls.mjs${new URL(import.meta.url).search}`);

export function createStockImageRenderer(registration, token, loadModule = (url) => import(url)) {
    const allowed = new Set(registration ? JSON.parse(registration.dataset.assets) : []);
    let module;
    return async (root, field, asset, alt, className) => {
        try {
            if (!registration || !allowed.has(asset.file)
                || !/^[a-z0-9-]+\.(?:png|jpg|gif|webp)$/.test(asset.file)) {
                throw new Error("Unauthorized packaged image");
            }
            module ??= loadModule(`${registration.dataset.module}?token=${encodeURIComponent(token)}`);
            const { mount, controlId, valueContract } = await module;
            validateStockImageAdapter(controlId, mount, valueContract);
            await mount({ root, field,
                value: `/assets/${encodeURIComponent(asset.file)}?token=${encodeURIComponent(token)}`,
                context: { alt, className } });
        } catch (error) {
            root.setAttribute("role", "alert");
            root.textContent = `Generated image could not render: ${error.message}`;
        }
    };
}

export async function mountPageAssets(content, slots, assets, mountImage) {
    const rendered = new Set();
    for (const target of content.querySelectorAll("[data-asset-slot]")) {
        const slotId = target.dataset.assetSlot;
        if (!slots.some((slot) => slot.id === slotId)
            || rendered.has(slotId)) {
            throw new Error(`Unknown or duplicate generated asset slot: ${slotId}`);
        }
        rendered.add(slotId);
        const asset = assets.find((item) => item.slot === slotId);
        if (!asset) continue;
        await mountImage(target, asset);
    }
    for (const asset of assets) {
        if (!rendered.has(asset.slot)) {
            throw new Error(`Generated page did not render asset slot ${asset.slot}`);
        }
    }
}
