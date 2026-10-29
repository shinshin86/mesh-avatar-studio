# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.4", "numpy", "opencv-python-headless"]
# ///
"""Prepare local edit masks and instructions for optional drawn eye/mouth variants."""

import argparse
import sys
from pathlib import Path

from agent_common import (
    ALL_EYE_VARIANTS,
    ALL_MOUTH_VARIANTS,
    edit_masks,
    inside_repo,
    project_image,
    read_rig,
    rgba_mask,
    save_image,
)

CHANGES = {
    "eyes_closed": "Close both eyes naturally, as in a relaxed blink: one clean upper lash line per eye that curves gently downward, not the upward arc of a smiling closed eye. Remove all visible iris and eye white, and the original upper lash and eyelid crease lines, so only the closed lash line remains. Keep the eyebrows unchanged.",
    "eyes_half": "Draw both eyes half closed, with the upper lids halfway down. Keep the iris visible only below the upper lid and preserve the original gaze.",
    "eyes_smile": "Draw both eyes closed in a gentle smiling upward arc, with clean lashes and no visible iris or eye white. Keep the eyebrows unchanged.",
    "eyes_sad": "Redraw both eyes as sad open eyes: the upper lids drooping at the outer corners and raised toward the nose, softer and slightly moist, with the gaze a little downward. Do not draw tears on the cheeks. Keep each eye in place and the eyebrows unchanged; they are moved separately.",
    "eyes_surprise": "Redraw both eyes as surprised wide-open eyes: the upper lids raised to show eye white above the iris, slightly smaller irises with clear highlights, and the gaze straight ahead. Keep each eye in place and the eyebrows unchanged; they are moved separately.",
    "mouth_angry": "Redraw the closed mouth as angry: a tight, closed mouth with the corners turned down into a firm frown (an upside-down V), slightly shorter than the original. Keep it closed with no teeth, and keep its center in place.",
    "mouth_sad": "Redraw the closed mouth as sad: a small closed mouth with the corners drooping downward in a gentle, soft curve, slightly wavering. Keep it closed with no teeth, and keep its center in place.",
    "mouth_a": "Open the mouth in the Japanese vowel あ (a): a natural vertically open mouth, with a subtle tongue and upper teeth.",
    "mouth_a_half": "Draw the Japanese vowel あ (a) at half openness: a smaller, gently open mouth.",
    "mouth_i": "Draw the Japanese vowel い (i): a wide, narrow open smile with subtle upper teeth.",
    "mouth_o": "Draw the Japanese vowel お (o): a small rounded open mouth.",
}


def generate(project):
    project = inside_repo(project)
    image, rig = project_image(project), read_rig(project)
    if rig["image"] != {"width": image.width, "height": image.height}:
        raise ValueError("rig.image must match source.png")
    eyes, mouth = edit_masks(rig, image.size)
    output = project / "variant-requests"
    output.mkdir(exist_ok=True)
    names = (*ALL_EYE_VARIANTS, *ALL_MOUTH_VARIANTS)
    for name in names:
        folder = output / name
        save_image(
            rgba_mask((eyes[0] | eyes[1]) if name in ALL_EYE_VARIANTS else mouth),
            folder / "mask.png",
        )
        prompt = (
            f"Edit the supplied source.png, exactly {image.width} x {image.height} pixels.\n\n"
            + CHANGES[name]
            + "\n\n"
            "Only fully transparent pixels (alpha = 0) in the supplied mask.png are editable; "
            "opaque pixels are protected. Preserve the original drawing style, line weight, "
            "skin colour, head pose, hair, accessories, clothing and transparent background. "
            "Return a full-size RGBA PNG, not a crop. Pixels outside the edit region must be "
            "identical to source.png, including alpha. Do not resize, shift, recolour or redraw "
            "the rest of the image. Keep all changes at least 4 pixels inside the mask edge "
            "so sprite feathering blends into the unchanged source.\n"
        )
        (folder / "prompt.md").write_text(prompt, encoding="utf-8")
    (output / "README.md").write_text(
        "# Drawn variant requests\n\n"
        f"Required output size: **{image.width} x {image.height}** pixels, RGBA PNG.\n\n"
        "For each variant below, supply `../source.png`, the variant's `mask.png`, and its "
        "`prompt.md` to an image editor you trust. The expression eyes (`eyes_sad`, `eyes_surprise`) "
        "and closed mouths (`mouth_angry`, `mouth_sad`) are optional; generate only the ones you want. Transparent mask pixels may change; opaque "
        "mask pixels must stay identical. Generating these files is a separate action: this "
        "command uploads nothing. If the image must stay local, use a local editor.\n\n"
        + "\n".join(
            f"- `{name}/mask.png` + `{name}/prompt.md` → `../variants/{name}.png`"
            for name in names
        )
        + "\n\nCreate the `variants/` directory in the project and save each full-size result there. "
        "Then run `uv run tools/build-sprites.py projects/<name>` from the repository root. "
        "It measures outside-mask changes and rejects shifted or redrawn images. Missing "
        "variants are skipped. Review the resulting poses again.\n",
        encoding="utf-8",
    )
    print(
        f"Prepared {len(names)} variant requests in {project.relative_to(project.parents[1])}/variant-requests/"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    args = parser.parse_args()
    try:
        generate(args.project)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"variant-requests: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
