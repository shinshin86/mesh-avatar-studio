# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.4", "numpy", "opencv-python-headless"]
# ///
"""Validate local full-size drawings and cut engine-compatible feathered sprites."""

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from agent_common import (
    EYE_VARIANTS,
    MOUTH_VARIANTS,
    edit_masks,
    inside_repo,
    project_image,
    read_rig,
)
from PIL import Image


def load_mask(path, size):
    with Image.open(path) as image:
        if image.size != size:
            raise ValueError(f"{path.name}: mask size must match source.png")
        alpha = np.array(image.convert("RGBA"))[..., 3]
    if np.any((alpha != 0) & (alpha != 255)):
        raise ValueError(
            f"{path.name}: use a binary alpha edit mask (0 editable, 255 protected)"
        )
    return (alpha == 0).astype(np.uint8)


def regions(project, rig, size, name):
    mask_path = project / "variant-requests" / name / "mask.png"
    legacy = (
        project
        / "variant-masks"
        / ("eyes_edit_mask.png" if name in EYE_VARIANTS else "mouth_edit_mask.png")
    )
    if mask_path.exists() or legacy.exists():
        region = load_mask(mask_path if mask_path.exists() else legacy, size)
        if name in EYE_VARIANTS:
            count, labels = cv2.connectedComponents(region)
            if count != 3:
                raise ValueError(
                    f"{name}: expected two separate eye mask regions, got {count - 1}"
                )
            components = sorted(
                range(1, count), key=lambda i: np.where(labels == i)[1].mean()
            )
            return [(labels == i).astype(np.uint8) for i in components]
        return [region]
    eyes, mouth = edit_masks(rig, size)
    return eyes if name in EYE_VARIANTS else [mouth]


def visible(image):
    value = image.astype(np.float32)
    value[..., :3] *= value[..., 3, None] / 255
    return value


def build(project, output=None, tolerance=8):
    project = inside_repo(project)
    if not np.isfinite(tolerance) or not 0 <= tolerance <= 255:
        raise ValueError("tolerance must be between 0 and 255")
    source_image, rig = project_image(project), read_rig(project)
    source = np.array(source_image)
    if rig["image"] != {"width": source_image.width, "height": source_image.height}:
        raise ValueError("rig.image must match source.png")
    images, meta = {}, {}
    for name in (*EYE_VARIANTS, *MOUTH_VARIANTS):
        path = project / "variants" / f"{name}.png"
        if not path.exists():
            print(f"Skipping missing variant: {name}")
            continue
        with Image.open(path) as image:
            if image.format != "PNG" or image.size != source_image.size:
                raise ValueError(
                    f"{name}: expected PNG size {source_image.width} x {source_image.height}, got {image.size}"
                )
            variant = np.array(image.convert("RGBA"))
        parts = regions(project, rig, source_image.size, name)
        region = np.maximum.reduce(parts)
        if not np.any(region) or np.all(region):
            raise ValueError(
                f"{name}: edit mask must contain a nonempty, bounded region"
            )
        delta = np.abs(visible(variant) - visible(source)).max(axis=-1)[region == 0]
        maximum, mean = float(delta.max(initial=0)), float(delta.mean())
        changed = int(np.count_nonzero(delta > tolerance))
        print(
            f"{name}: outside-mask max {maximum:.3f}/255, mean {mean:.6f}/255, {changed} pixels over tolerance {tolerance:g}"
        )
        if changed:
            raise ValueError(
                f"{name}: rejected outside-mask changes; preserve source pixels outside the edit region"
            )
        for i, part in enumerate(parts):
            weight = np.clip(cv2.distanceTransform(part, cv2.DIST_L2, 5) / 4, 0, 1)
            ys, xs = np.where(weight > 0)
            if not len(xs):
                raise ValueError(f"{name}: empty sprite mask")
            x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
            crop = variant[y0:y1, x0:x1].copy()
            crop[..., 3] = (crop[..., 3] * weight[y0:y1, x0:x1]).astype(np.uint8)
            layer = f"{name}_{i}" if name in EYE_VARIANTS else name
            images[layer] = crop
            meta[layer] = [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]
    if not images:
        print("No variants available; existing sprites were left unchanged.")
        return
    output = inside_repo(output or project / "built/sprites")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".build-sprites-", dir=output.parent
    ) as temporary:
        stage = Path(temporary)
        for name, crop in images.items():
            Image.fromarray(crop).save(stage / f"{name}.png")
        build_id = hashlib.sha1(
            b"".join((stage / f"{name}.png").read_bytes() for name in sorted(meta))
        ).hexdigest()[:10]
        (stage / "sprites.json").write_text(
            json.dumps({"build": build_id, "layers": meta, "version": 1}, indent=2) + "\n",
            encoding="utf-8",
        )
        output.mkdir(exist_ok=True)
        for filename in [*(f"{name}.png" for name in meta), "sprites.json"]:
            (stage / filename).replace(output / filename)
    print(f"Built {len(meta)} sprites; build {build_id}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument(
        "--out",
        type=Path,
        help="Alternate output inside the repository (for reference comparisons)",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=8,
        help="Maximum outside-mask premultiplied RGBA channel difference, 0..255 (default: 8)",
    )
    args = parser.parse_args()
    try:
        build(args.project, args.out, args.tolerance)
    except (OSError, ValueError, KeyError, TypeError, cv2.error) as error:
        print(f"build-sprites: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
