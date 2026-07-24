#!/usr/bin/env python3
"""Shrink the Open Graph share images in place.

The og-*.png cards are dark, gradient-heavy 1200x630 renders whose subject is
large gold serif text. Truecolour PNG stores them at ~300-560KB each; a 256
colour adaptive palette with Floyd-Steinberg dithering reproduces them at
~45dB PSNR (measured: visually indistinguishable at 1:1, including the text
edges and the fine filament gradients) for roughly half the bytes.

Palette PNG is preferred over JPEG here even though JPEG is slightly smaller at
equal PSNR: these cards are mostly high-contrast text, which JPEG surrounds with
ringing artefacts, and staying PNG keeps every existing /assets/img/*.png
reference (index.html, shared/course-seo.js, articles) valid.

Idempotent: images already stored as palette PNGs are left untouched, so
re-running never re-quantises and degrades a previous pass.

Usage: python3 scripts/optimize-og-images.py [--check]
  --check  report what would change and exit non-zero if anything is unoptimised
           (so CI can catch a newly added truecolour card)
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "assets" / "img"
COLORS = 256


def optimize(path: Path, check_only: bool) -> tuple[bool, int, int]:
    """Return (changed, before, after) for one image."""
    before = path.stat().st_size
    with Image.open(path) as im:
        if im.mode == "P":  # already palette-optimised
            return False, before, before
        if check_only:
            return True, before, before
        quantized = im.convert("RGB").quantize(
            colors=COLORS, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG
        )
        quantized.save(path, "PNG", optimize=True, compress_level=9)
    return True, before, path.stat().st_size


def main() -> int:
    check_only = "--check" in sys.argv
    targets = sorted(p for p in IMG_DIR.glob("og*.png"))
    if not targets:
        print("no og*.png images found", file=sys.stderr)
        return 1

    total_before = total_after = 0
    pending = []
    for path in targets:
        changed, before, after = optimize(path, check_only)
        total_before += before
        total_after += after
        if changed:
            pending.append(path.name)
            if not check_only:
                print(f"  {path.name}: {before:,} -> {after:,} bytes ({after / before:.0%})")

    if check_only:
        if pending:
            print("unoptimised Open Graph images: " + ", ".join(pending), file=sys.stderr)
            return 1
        print(f"OG images optimised: {len(targets)} files, {total_before:,} bytes")
        return 0

    saved = total_before - total_after
    print(
        f"Optimised {len(pending)}/{len(targets)} images: "
        f"{total_before:,} -> {total_after:,} bytes (saved {saved:,}, {saved / total_before:.0%})"
        if pending else f"All {len(targets)} images already optimised."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
