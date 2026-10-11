# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.4"]
# ///
"""Create a private local project skeleton; its empty eye polygons must be traced."""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

from agent_common import ROOT, inside_repo, save_json
from PIL import Image


def create(source, name, force=False):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", name):
        raise ValueError("name must use letters, digits, hyphens or underscores")
    with Image.open(source) as image:
        if image.format != "PNG":
            raise ValueError("input must be a PNG")
        image.load()
        w, h = image.size
        if "A" not in image.getbands() and "transparency" not in image.info:
            print(
                "Warning: no alpha channel; a transparent background is recommended.",
                file=sys.stderr,
            )
        if h < 800:
            print(
                "Warning: image is less than 800 px tall; eye details may be difficult to trace.",
                file=sys.stderr,
            )
    project = inside_repo(ROOT / "projects" / name)
    if not project.is_relative_to((ROOT / "projects").resolve()):
        raise ValueError(
            "project must stay inside projects/; redirected paths are not allowed"
        )
    if project.exists() and not force:
        raise ValueError(
            "project already exists; use --force to replace source and draft (other files are retained)"
        )
    if (project / "source.png").resolve() == source.resolve():
        raise ValueError("input is already this project's source.png")
    template = json.loads((ROOT / "samples/miko-qipao/rig.json").read_text())
    ellipse = lambda x, y, rx, ry: {
        "cx": w * x,
        "cy": h * y,
        "rx": w * rx,
        "ry": h * ry,
    }
    rig = {
        "version": 1,
        "image": {"width": w, "height": h},
        "head": {
            **ellipse(0.5, 0.3, 0.3, 0.3),
            "shiftX": 0,
            "shiftY": 0,
            "pivotX": w / 2,
            "pivotY": h * 0.55,
            "maxRoll": 0.15,
            "weightBand": [h * 0.5, h * 0.65],
            "turnBand": [h * 0.5, h * 0.7],
        },
        "body": {
            "pivotX": w / 2,
            "pivotY": h,
            "maxRoll": 0.035,
            "breathBand": [h * 0.6, h],
            "rollBand": [h * 0.5, h],
            "chest": ellipse(0.5, 0.75, 0.3, 0.25),
            "shoulders": [],
        },
        "face": {
            name: ellipse(0.5, 0.35, 0.04, 0.03)
            for name in ("nose", "mouth", "eyeA", "eyeB", "earL", "earR", "brow", "jaw")
        },
        "eyes": [{"opening": [], "roi": []} for _ in range(2)],
        "mouth": {
            "cx": w / 2,
            "cy": h * 0.45,
            "angle": 0,
            "halfLen": w * 0.04,
            "bow": 0,
            "area": {**ellipse(0.5, 0.45, 0.06, 0.03), "angle": 0},
        },
        "cheeks": [[w * 0.4, h * 0.4], [w * 0.6, h * 0.4]],
        "mesh": template["mesh"],
        "view": template["view"],
    }
    for part in ("brow", "jaw"):
        rig["face"][part]["band"] = [h * 0.4, h * 0.45]
    # Retain engine defaults, but no example illustration's gaze origin.
    rig["view"].pop("gazeCenter", None)
    (project / "work").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, project / "source.png")
    save_json(rig, project / "rig.draft.json")
    if not (project / "avatar.json").exists():
        save_json({"format": "mesh-avatar", "version": 1, "name": name}, project / "avatar.json")
    print(
        f"Created projects/{name}/ ({w} x {h}). Trace the empty eyes and place every required region before building."
    )
    if force:
        print(
            "Existing generated layers/variants were retained; rebuild and review before use."
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("name")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        create(args.image, args.name, args.force)
    except (OSError, ValueError) as error:
        print(f"new-project: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
