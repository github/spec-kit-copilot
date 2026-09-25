"""Confined theme asset resolution for a generated candidate."""

import struct
from pathlib import Path

from validation import declared_file, package_file


IMAGE_LIMIT = 1024 * 1024
DIMENSION_LIMIT = 2048


def _dimensions(data: bytes, extension: str) -> tuple[int, int]:
    if extension == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        if data[12:16] == b"IHDR" and int.from_bytes(data[8:12], "big") == 13:
            return struct.unpack(">II", data[16:24])
    if extension in (".jpg", ".jpeg") and data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9"):
        index = 2
        while index + 4 < len(data):
            if data[index] != 0xff:
                break
            marker = data[index + 1]
            if marker in (0xd8, 0xd9) or 0xd0 <= marker <= 0xd7:
                index += 2
                continue
            length = int.from_bytes(data[index + 2:index + 4], "big")
            if length < 2 or index + 2 + length > len(data):
                break
            if marker in (0xc0, 0xc1, 0xc2) and length >= 7:
                return struct.unpack(">HH", data[index + 5:index + 9])[::-1]
            index += 2 + length
    if extension == ".webp" and len(data) >= 30 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        if int.from_bytes(data[4:8], "little") + 8 != len(data):
            raise ValueError("Invalid WebP resource length")
        kind = data[12:16]
        if kind == b"VP8X":
            return (int.from_bytes(data[24:27], "little") + 1,
                    int.from_bytes(data[27:30], "little") + 1)
        if kind == b"VP8L" and len(data) >= 25 and data[20] == 0x2f:
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
        if kind == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
            return (int.from_bytes(data[26:28], "little") & 0x3fff,
                    int.from_bytes(data[28:30], "little") & 0x3fff)
    raise ValueError("Unsupported or malformed PNG, JPEG, or WebP logo")


def logo_file(workspace: Path, package: Path, theme: dict, binding: dict) -> tuple[str, bytes] | None:
    logo = theme["brand"]["logo"]
    if logo["mode"] in ("default", "hidden", "none"):
        return None
    name = logo["path"]
    owner = binding["provider"]
    if owner["kind"] in ("preset", "extension"):
        source = package_file(workspace, owner["kind"], owner["id"], name)
    elif owner["kind"] == "project":
        source = declared_file(workspace, name, maximum=IMAGE_LIMIT)
    else:
        raise ValueError("Unsupported logo asset provider")
    if source.stat().st_size > IMAGE_LIMIT:
        raise ValueError("Logo asset exceeds supported bytes")
    data = source.read_bytes()
    width, height = _dimensions(data, Path(name).suffix.lower())
    if not 0 < len(data) <= IMAGE_LIMIT or not (0 < width <= DIMENSION_LIMIT and 0 < height <= DIMENSION_LIMIT):
        raise ValueError("Logo asset exceeds supported bytes or dimensions")
    return name, data
