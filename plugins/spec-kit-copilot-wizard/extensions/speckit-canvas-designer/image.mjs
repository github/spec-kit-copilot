export const IMAGE_TYPES = {
    "image/png": { extension: "png", signature: [137, 80, 78, 71, 13, 10, 26, 10] },
    "image/jpeg": { extension: "jpg", signature: [255, 216, 255] },
    "image/gif": { extension: "gif", signature: [71, 73, 70, 56] },
    "image/webp": { extension: "webp", signature: [82, 73, 70, 70] },
};

function validJpeg(bytes) {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216) return false;
    let offset = 2;
    let frame = false;
    let scan = false;
    while (offset < bytes.length) {
        if (bytes[offset++] !== 255) return false;
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 217) return frame && scan && offset === bytes.length;
        if (marker === 0 || marker === 216 || marker === undefined) return false;
        if (marker >= 208 && marker <= 215) {
            if (!scan) return false;
            continue;
        }
        if (offset + 2 > bytes.length) return false;
        const length = bytes.readUInt16BE(offset);
        if (length < 2 || offset + length > bytes.length) return false;
        if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
            if (length < 11 || length !== 8 + 3 * bytes[offset + 7]
                || !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)) return false;
            frame = true;
        }
        offset += length;
        if (marker === 218) {
            if (!frame || length < 6 || offset >= bytes.length - 2) return false;
            scan = true;
            const start = offset;
            while (offset < bytes.length) {
                if (bytes[offset] !== 255) { offset++; continue; }
                let next = offset + 1;
                while (bytes[next] === 255) next++;
                if (bytes[next] === 0 || bytes[next] >= 208 && bytes[next] <= 215) {
                    offset = next + 1;
                    continue;
                }
                break;
            }
            if (offset === start) return false;
        }
    }
    return false;
}

export function decodeImage(value, maxBytes = 32 * 1024) {
    if (value === "") return null;
    const match = typeof value === "string"
        && /^data:(image\/(?:png|jpeg|gif|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(value);
    if (!match || match[2].length > Math.ceil(maxBytes / 3) * 4) {
        throw new Error("Invalid Designer image: expected a PNG, JPEG, GIF, or WebP under 32 KiB");
    }
    const bytes = Buffer.from(match[2], "base64");
    const type = IMAGE_TYPES[match[1]];
    if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64") !== match[2]
        || !type.signature.every((part, index) => bytes[index] === part)
        || (match[1] === "image/png" && (bytes.length < 24
            || bytes.toString("ascii", 12, 16) !== "IHDR"))
        || (match[1] === "image/jpeg" && !validJpeg(bytes))
        || (match[1] === "image/gif" && (bytes.length < 14
            || !["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))))
        || (match[1] === "image/webp" && (bytes.length < 16
            || bytes.toString("ascii", 8, 12) !== "WEBP"
            || bytes.readUInt32LE(4) + 8 !== bytes.length))) {
        throw new Error("Invalid Designer image: image bytes do not match their declared format");
    }
    return { mime: match[1], extension: type.extension, bytes };
}
