# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.4"]
# ///
"""Review rig regions and node indices on a source image using editor part colours."""

import argparse
import math
import re
import sys
from pathlib import Path

from agent_common import ROOT, font, grid_image, project_image, read_rig, save_image
from PIL import Image, ImageDraw


def geometry(rig):
    shapes = []

    def add(group, path, points, closed=False):
        shapes.append((group, path, points, closed))

    def walk(value, path, group):
        key = path.split(".")[-1]
        if isinstance(value, dict):
            if all(k in value for k in ("cx", "cy", "rx", "ry")):
                angle = value.get("angle", 0)
                points = []
                for i in range(64):
                    theta = i * math.tau / 64
                    x, y = value["rx"] * math.cos(theta), value["ry"] * math.sin(theta)
                    points.append(
                        [
                            value["cx"] + x * math.cos(angle) - y * math.sin(angle),
                            value["cy"] + x * math.sin(angle) + y * math.cos(angle),
                        ]
                    )
                add(group, path, points, True)
                add(group, path + ".centre", [[value["cx"], value["cy"]]])
            if all(k in value for k in ("cx", "cy", "halfLen", "angle")):
                angle = value["angle"]
                points = []
                for i in range(33):
                    s = i / 16 - 1
                    x = s * value["halfLen"]
                    y = value.get("bow", 0) * (1 - s * s)
                    points.append(
                        [
                            value["cx"] + x * math.cos(angle) - y * math.sin(angle),
                            value["cy"] + x * math.sin(angle) + y * math.cos(angle),
                        ]
                    )
                add(group, path + ".line", points)
            if all(k in value for k in ("pivotX", "pivotY")):
                add(group, path + ".pivot", [[value["pivotX"], value["pivotY"]]])
            if all(k in value for k in ("x0", "y0", "x1", "y1")):
                x0, y0, x1, y1 = (value[k] for k in ("x0", "y0", "x1", "y1"))
                add(group, path, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], True)
            if "pivot" in value and "tip" in value:
                add(group, path + ".axis", [value["pivot"], value["tip"]])
            for key, child in value.items():
                walk(child, path + "." + key, group)
        elif isinstance(value, list) and value:
            if all(
                isinstance(p, list)
                and len(p) == 2
                and all(isinstance(n, (int, float)) for n in p)
                for p in value
            ):
                if group == "cheeks":
                    for i, point in enumerate(value):
                        add(group, f"{path}.{i}", [point])
                else:
                    add(
                        group,
                        path,
                        value,
                        key in ("opening", "roi", "outline", "background"),
                    )
            elif len(value) == 2 and all(isinstance(n, (int, float)) for n in value):
                if key.endswith("Band") or key in ("band", "jawRange"):
                    for i, position in enumerate(value):
                        points = (
                            [[position, 0], [position, rig["image"]["height"]]]
                            if key in ("fingerXBand", "jawRange")
                            else [[0, position], [rig["image"]["width"], position]]
                        )
                        add(group, f"{path}.{i}", points)
                else:
                    add(group, path, [value])
            elif key == "box" and len(value) == 4:
                x0, y0, x1, y1 = value
                add(group, path, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], True)
            elif key not in ("top", "bot"):
                for i, child in enumerate(value):
                    walk(child, f"{path}.{i}", group)

    for group, value in rig.items():
        if group not in ("version", "image"):
            walk(value, group, group)
    if "gazeCenter" not in rig["view"]:
        add(
            "view",
            "view.gazeCenter (head centre)",
            [[rig["head"]["cx"], rig["head"]["cy"]]],
        )
    return shapes


def overlay(project, rig_name, part, zoom, output):
    image, rig = project_image(project), read_rig(project, rig_name)
    if rig["image"] != {"width": image.width, "height": image.height}:
        raise ValueError("rig.image must match source.png")
    colours_text = (
        (ROOT / "src/editor/parts.ts")
        .read_text()
        .split("PART_COLORS:")[1]
        .split("export const SECTIONS")[0]
    )
    colours = dict(re.findall(r"(\w+): '(#[0-9a-fA-F]+)'", colours_text))
    # optional groups the editor does not colour yet (such as cloth)
    colours.setdefault("cloth", "#e040a0")
    if part and part.split(".")[0] not in colours:
        raise ValueError("unknown part; use " + ", ".join(colours))
    shapes = [
        s
        for s in geometry(rig)
        if not part or s[1] == part or s[1].startswith(part + ".")
    ]
    if not shapes:
        raise ValueError("selected part has no placed geometry")
    if zoom:
        points = [p for _, _, pts, _ in shapes for p in pts]
        xs, ys = zip(*points)
        region = (
            max(0, math.floor(min(xs) - 20)),
            max(0, math.floor(min(ys) - 20)),
            min(image.width, math.ceil(max(xs) + 20)),
            min(image.height, math.ceil(max(ys) + 20)),
        )
        result, transform = grid_image(image, region, 10)
    else:
        bg = Image.new("RGBA", image.size, (145, 145, 145, 255))
        bg.alpha_composite(image)
        result = bg.convert("RGB")
        transform = lambda p: p
    draw = ImageDraw.Draw(result)
    for group, label, points, closed in shapes:
        mapped = [transform(p) for p in points]
        color = colours[group]
        if len(mapped) > 1:
            draw.line(mapped + ([mapped[0]] if closed else []), fill=color, width=2)
        # Ellipse sampling has no user node indices; polylines do.
        sampled_ellipse = len(points) in (33, 64)
        for i, (x, y) in enumerate(mapped if not sampled_ellipse else mapped[:1]):
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=color, outline="white")
            text = label if i == 0 else str(i)
            tx, ty = (
                max(0, min(result.width - 180, x + 5)),
                max(0, min(result.height - 18, y - 18)),
            )
            bounds = draw.textbbox((tx, ty), text, font=font(13))
            draw.rectangle(bounds, fill="white")
            draw.text((tx, ty), text, fill=color, font=font(13))
    save_image(result, output)
    print(f"Overlay written: {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--rig")
    parser.add_argument("--part")
    parser.add_argument("--zoom", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        overlay(args.project, args.rig, args.part, args.zoom, args.out)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"overlay: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
