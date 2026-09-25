"""Theme image validation without an alternate presentation renderer."""

import copy
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE / "scripts" / "lib"))

from experience import default_document  # noqa: E402
from theme_asset import _dimensions, logo_file  # noqa: E402


def png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00" + b"\x00\x00\x00" * width))
            + chunk(b"IEND", b""))


class ThemeAssetContracts(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)

    def test_theme_logo_asset_is_confined_and_dimension_bounded(self) -> None:
        root = self.workspace / ".specify" / "presets" / "design"
        (root / "assets").mkdir(parents=True)
        asset = root / "assets" / "logo.png"
        asset.write_bytes(png(1, 1))
        theme = copy.deepcopy(default_document(PACKAGE, "canvas-presentation"))
        binding = {"provider": {"kind": "preset", "id": "design"}}
        self.assertIsNone(logo_file(self.workspace, PACKAGE, theme, binding))
        theme["brand"]["logo"] = {"mode": "asset", "path": "assets/logo.png", "alt": "Design"}
        self.assertEqual(logo_file(self.workspace, PACKAGE, theme, binding), ("assets/logo.png", asset.read_bytes()))
        asset.write_bytes(png(2049, 1))
        with self.assertRaisesRegex(ValueError, "dimensions"):
            logo_file(self.workspace, PACKAGE, theme, binding)
        asset.write_bytes(b"not an image")
        with self.assertRaisesRegex(ValueError, "malformed"):
            logo_file(self.workspace, PACKAGE, theme, binding)

    def test_supported_image_headers_report_dimensions(self) -> None:
        jpeg = (b"\xff\xd8\xff\xc0\x00\x11\x08\x00\x02\x00\x03\x03"
                b"\x01\x11\x00\x02\x11\x00\x03\x11\x00\xff\xd9")
        vp8x = b"VP8X" + struct.pack("<I", 10) + b"\x00\x00\x00\x00" + b"\x02\x00\x00\x01\x00\x00"
        webp = b"RIFF" + struct.pack("<I", 4 + len(vp8x)) + b"WEBP" + vp8x
        self.assertEqual(_dimensions(jpeg, ".jpg"), (3, 2))
        self.assertEqual(_dimensions(webp, ".webp"), (3, 2))
        with self.assertRaises(ValueError):
            _dimensions(webp + b"garbage", ".webp")
