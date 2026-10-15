#!/usr/bin/env python3
"""منار ايفون — أيقونة التطبيق وشاشة البدء لـiOS من المعلم نفسه.

يعيد استخدام رسم المنارة في scripts/build-icon.py (المصدر الواحد للهوية)،
ويُخرج ما يشترطه iOS:
  • AppIcon 1024×1024 مربّعة كاملة الحوافّ بلا شفافية — النظام يقصّ الزوايا
    بنفسه، وأي قناة شفافية تُرفض في التحقق أو تظهر سوداء.
  • Splash بثلاث كثافات 2732×2732 بخلفية منار الداكنة والمعلم في الوسط —
    تُعرض بـ aspectFill فيبقى الوسط ظاهراً على كل أحجام iPhone.
  • AccentColor ذهبي.

التشغيل: python3 scripts/build-ios-icon.py   (يحتاج cairosvg و Pillow)
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "ios" / "App" / "App" / "Assets.xcassets"

spec = importlib.util.spec_from_file_location("manar_icon", ROOT / "scripts" / "build-icon.py")
icon = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(icon)

C = icon.C


def svg_ios_icon() -> str:
    """لوحة كاملة بلا زوايا مستديرة (iOS يطبّق قناعه)، والمعلم أصغر قليلاً
    من نسخة أندرويد المربّعة ليبقى بعيداً عن حوافّ القناع."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{C}" height="{C}" viewBox="0 0 {C} {C}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{icon.EMERALD}"/>
      <stop offset="55%" stop-color="{icon.EMERALD_DEEP}"/>
      <stop offset="100%" stop-color="{icon.BG_DEEP}"/>
    </linearGradient>
    <radialGradient id="halo">
      <stop offset="0%" stop-color="{icon.GOLD_PALE}" stop-opacity="0.85"/>
      <stop offset="55%" stop-color="{icon.GOLD_LIGHT}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="{icon.GOLD_LIGHT}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow">
      <stop offset="0%" stop-color="{icon.EMERALD}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="{icon.EMERALD}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{C}" height="{C}" fill="url(#bg)"/>
  <circle cx="{icon.CX}" cy="{icon.CY * 0.72}" r="{C * 0.5}" fill="url(#glow)"/>
  {icon.minaret(0.88)}
</svg>"""


def svg_splash_mark() -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{C}" height="{C}" viewBox="0 0 {C} {C}">
  <defs>
    <radialGradient id="halo">
      <stop offset="0%" stop-color="{icon.GOLD_PALE}" stop-opacity="0.85"/>
      <stop offset="55%" stop-color="{icon.GOLD_LIGHT}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="{icon.GOLD_LIGHT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  {icon.minaret(0.9)}
</svg>"""


def render(svg: str, size: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def main() -> int:
    # الأيقونة: RGB بلا قناة شفافية
    app_icon = ASSETS / "AppIcon.appiconset"
    app_icon.mkdir(parents=True, exist_ok=True)
    for old in app_icon.glob("*.png"):
        old.unlink()
    img = render(svg_ios_icon(), 1024)
    flat = Image.new("RGB", img.size, hex_rgb(icon.BG_DEEP))
    flat.paste(img, mask=img.split()[3])
    flat.save(app_icon / "AppIcon-1024.png", optimize=True)
    (app_icon / "Contents.json").write_text(
        json.dumps(
            {
                "images": [
                    {
                        "filename": "AppIcon-1024.png",
                        "idiom": "universal",
                        "platform": "ios",
                        "size": "1024x1024",
                    }
                ],
                "info": {"author": "xcode", "version": 1},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print("  ✓ AppIcon 1024×1024 (RGB، بلا شفافية)")

    # شاشة البدء
    splash = ASSETS / "Splash.imageset"
    splash.mkdir(parents=True, exist_ok=True)
    for old in splash.glob("*.png"):
        old.unlink()
    side = 2732
    mark = render(svg_splash_mark(), 900)
    canvas = Image.new("RGB", (side, side), hex_rgb(icon.BG_DEEP))
    canvas.paste(mark, ((side - 900) // 2, (side - 900) // 2), mask=mark.split()[3])
    names = []
    for scale in ("1x", "2x", "3x"):
        name = f"splash-2732x2732-{scale}.png"
        canvas.save(splash / name, optimize=True)
        names.append((name, scale))
    (splash / "Contents.json").write_text(
        json.dumps(
            {
                "images": [{"idiom": "universal", "filename": n, "scale": s} for n, s in names],
                "info": {"author": "xcode", "version": 1},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print("  ✓ Splash 2732×2732 ×3")

    accent = ASSETS / "AccentColor.colorset"
    accent.mkdir(parents=True, exist_ok=True)
    r, g, b = hex_rgb(icon.GOLD)
    (accent / "Contents.json").write_text(
        json.dumps(
            {
                "colors": [
                    {
                        "color": {
                            "color-space": "srgb",
                            "components": {
                                "alpha": "1.000",
                                "red": f"0x{r:02X}",
                                "green": f"0x{g:02X}",
                                "blue": f"0x{b:02X}",
                            },
                        },
                        "idiom": "universal",
                    }
                ],
                "info": {"author": "xcode", "version": 1},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print("  ✓ AccentColor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
