#!/usr/bin/env python3
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "assets" / "img"
COLORS = 256

def optimize(path: Path, check_only: bool) -> tuple[bool, int, int]:
    before = path.stat().st_size
    with Image.open(path) as im:
        if im.mode == "P":
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
