#!/usr/bin/env python3
"""Build local animation layers from source.png and rig geometry.

Run with: uv run --with numpy --with pillow --with opencv-python-headless
          tools/build-layers.py <project-dir> [--rig rig.draft.json]
"""

import argparse
import hashlib
import json
import math
import re
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# The renderer samples each eye at 24 columns. Other constants below control
# filtering, antialiasing and solver convergence, rather than illustration geometry.
EYE_SAMPLES = 24


def polygon_mask(shape, poly):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.array(poly, np.int32)], 255)
    return m


def accessory_mask(rgba, accessory):
    rgb = rgba[..., :3]
    box = accessory["box"]
    x0, y0, x1, y1 = box
    r, g, b = [rgb[..., i].astype(np.float32) for i in range(3)]
    redness = (r - np.maximum(g, b)) / np.maximum(r, 1)
    m = (
        (redness > accessory["color"]["redness"])
        & (r > accessory["color"]["minRed"])
        & (rgba[..., 3] > 0)
    ).astype(np.uint8) * 255
    box_m = np.zeros_like(m)
    box_m[y0:y1, x0:x1] = 255
    m &= box_m
    # keep only the biggest connected blob (the tassel), close small holes
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    if n > 1:
        big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        m = np.where(lab == big, 255, 0).astype(np.uint8)
    # grab the anti-aliased dark outline around the red
    return cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=1)


def crop_layer(rgba, mask, pad=4, soft=True):
    ys, xs = np.where(mask > 0)
    if not len(xs):
        return np.zeros((1, 1, 4), np.uint8), [0, 0, 1, 1]
    x0, y0 = max(xs.min() - pad, 0), max(ys.min() - pad, 0)
    x1, y1 = (
        min(xs.max() + pad + 1, rgba.shape[1]),
        min(ys.max() + pad + 1, rgba.shape[0]),
    )
    layer = rgba.copy()
    soft = (cv2.GaussianBlur(mask, (3, 3), 0) if soft else mask).astype(
        np.float32
    ) / 255
    layer[..., 3] = (layer[..., 3].astype(np.float32) * soft).astype(np.uint8)
    return layer[y0:y1, x0:x1], [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def inpaint_rgba(rgba, mask):
    rgb = cv2.inpaint(np.ascontiguousarray(rgba[..., :3]), mask, 9, cv2.INPAINT_TELEA)
    a = cv2.inpaint(np.ascontiguousarray(rgba[..., 3]), mask, 9, cv2.INPAINT_TELEA)
    out = np.dstack([rgb, a])
    return out


def column_span(poly, x):
    """min / max y where the vertical line at x crosses the polygon."""
    ys = []
    n = len(poly)
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        if (ax - x) * (bx - x) <= 0 and ax != bx:
            ys.append(ay + (by - ay) * (x - ax) / (bx - ax))
    if len(ys) < 2:
        raise ValueError(
            "eye opening must enclose a vertical span at every sampled column"
        )
    return min(ys), max(ys)


def eye_curves(e):
    """Top / bottom edge of the opening sampled at EYE_SAMPLES columns (for the renderer)."""
    xs = [p[0] for p in e["opening"]]
    x0, x1 = min(xs), max(xs)
    top, bot = [], []
    for i in range(EYE_SAMPLES):
        x = x0 + (x1 - x0) * min(max(i / (EYE_SAMPLES - 1), 0.002), 0.998)
        t, b = column_span(e["opening"], x)
        top.append(round(t, 2))
        bot.append(round(b, 2))
    # the ends are the eye corners: top and bottom meet there
    for k in (0, -1):
        top[k] = bot[k] = round((top[k] + bot[k]) / 2, 2)
    return {"x0": x0, "x1": x1, "top": top, "bot": bot}


def unblend(rgba, skin_rgb, mask, ink):
    """RGBA layer that reproduces rgba where it lies over skin_rgb (soft line edges keep
    their antialiasing instead of carrying a halo of the old background)."""
    orig = rgba[..., :3].astype(np.float32)
    sk = skin_rgb.astype(np.float32)
    ref = np.array(ink, np.float32)
    a = np.clip(((sk - orig) / np.maximum(sk - ref, 1)).max(-1), 0, 1)
    a *= mask > 0
    col = np.clip(
        (orig - sk * (1 - a[..., None])) / np.maximum(a[..., None], 1e-3), 0, 255
    )
    out = np.zeros_like(rgba)
    out[..., :3] = col.astype(np.uint8)
    out[..., 3] = (a * 255).astype(np.uint8)
    return out


def luminance(rgb):
    return rgb @ np.array([0.3, 0.59, 0.11], np.float32)


def skin_samples(img, hole):
    """Estimate local skin from the brighter half of the opaque boundary ring."""
    ring = (
        (cv2.dilate(hole, np.ones((25, 25), np.uint8)) > 0)
        & (hole == 0)
        & (img[..., 3] > 200)
    )
    pixels = img[..., :3][ring].astype(np.float32)
    if not len(pixels):
        raise ValueError("no opaque pixels around a cut-out region to estimate skin")
    light = pixels[luminance(pixels) >= np.percentile(luminance(pixels), 55)]
    colour = np.median(light, axis=0)
    spread = np.median(np.abs(light - colour).max(-1))
    return colour, max(22, min(60, spread * 3))


def fill_skin(img, hole):
    """Continue locally estimated shading into a hole by a membrane solve."""
    if not np.any(hole):
        return img.copy()
    rgb = img[..., :3].astype(np.float32)
    colour, tolerance = skin_samples(img, hole)
    skin = (
        (hole == 0) & (np.abs(rgb - colour).max(-1) < tolerance) & (img[..., 3] > 200)
    )
    est = rgb.copy()
    known = skin.astype(np.float32)
    for sigma in (3, 6, 12, 24, 48):
        num = cv2.GaussianBlur(rgb * known[..., None], (0, 0), sigma)
        den = cv2.GaussianBlur(known, (0, 0), sigma)[..., None]
        fill = (known == 0) & (den[..., 0] > 0.02)
        est[fill] = (num / np.maximum(den, 1e-4))[fill]
        known = np.maximum(known, fill.astype(np.float32) * 0.5)
    solve = (hole > 0) | ((cv2.dilate(hole, np.ones((17, 17), np.uint8)) > 0) & ~skin)
    ys, xs = np.where(solve)
    y0, y1 = max(ys.min() - 2, 0), min(ys.max() + 3, img.shape[0])
    x0, x1 = max(xs.min() - 2, 0), min(xs.max() + 3, img.shape[1])
    cur = np.where(solve[..., None], est, rgb)[y0:y1, x0:x1].copy()
    m = solve[y0:y1, x0:x1]
    fixed = cur.copy()
    for _ in range(600):
        cur = np.where(m[..., None], cv2.blur(cur, (3, 3)), fixed)
    out = rgb.copy()
    out[y0:y1, x0:x1] = cur
    k = cv2.GaussianBlur((hole > 0).astype(np.float32), (0, 0), 1.0)[..., None]
    res = img.copy()
    res[..., :3] = np.clip(rgb * (1 - k) + out * k, 0, 255).astype(np.uint8)
    # A cut-out cannot create opacity outside the original illustration.
    return res


def eye_classes(rgba, eye):
    h, w = rgba.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    c = eye_curves(eye)
    top = np.interp(xx, np.linspace(c["x0"], c["x1"], EYE_SAMPLES), c["top"])
    inside_x = (xx >= c["x0"]) & (xx <= c["x1"])
    rgb = rgba[..., :3].astype(np.float32)
    region = polygon_mask((h, w), eye["roi"])
    core = polygon_mask((h, w), eye["opening"])
    opaque = rgba[..., 3] > 0
    est = fill_skin(rgba, region)[..., :3].astype(np.float32)
    skin = np.abs(rgb - est).max(-1) < 22
    ink = (region > 0) & ~skin & (core == 0) & opaque
    core_pixels = rgb[(core > 0) & opaque]
    white_colour = np.median(
        core_pixels[
            luminance(core_pixels) >= np.percentile(luminance(core_pixels), 85)
        ],
        axis=0,
    )
    white = (np.abs(rgb - white_colour).max(-1) < 20) & (
        luminance(rgb) > luminance(est)
    )
    dark_pixels = rgb[(region > 0) & opaque]
    dark = np.percentile(luminance(dark_pixels), 10)
    light = np.median(luminance(est[region > 0]))
    corner_line = np.interp(xx, [c["x0"], c["x1"]], [c["top"][0], c["top"][-1]])
    upper = np.where(inside_x, yy <= top + 3, yy <= corner_line + 2)
    crease = (
        ink & inside_x & (yy < top - 9) & (luminance(rgb) > (light + dark) / 2) & ~white
    )
    lash = ink & upper & ~crease & ~white
    low = ink & ~upper & ~white
    m8 = lambda m: m.astype(np.uint8) * 255
    ball = cv2.dilate(core, np.ones((3, 3), np.uint8))
    return (
        ball,
        m8(lash),
        m8(low),
        m8(crease),
        m8(ink & white & (ball == 0)),
        core,
        white,
    )


def infer_ink(rgba, mask, skin):
    """Darkest local stroke colour, without a fixed illustration-specific palette."""
    pixels = rgba[..., :3][(mask > 0) & (rgba[..., 3] > 200)].astype(np.float32)
    if not len(pixels):
        return skin
    dark = luminance(pixels) <= np.percentile(luminance(pixels), 10)
    return np.median(pixels[dark], axis=0)


def ellipse_mask(shape, region):
    yy, xx = np.mgrid[: shape[0], : shape[1]]
    return ((xx - region["cx"]) / region["rx"]) ** 2 + (
        (yy - region["cy"]) / region["ry"]
    ) ** 2 <= 1


def hair_mask(rgba, rig):
    """Grow sampled hair colours over the head and buns, excluding skin and clothes."""
    shape = rgba.shape[:2]
    sample = np.zeros(shape, np.uint8)
    scope = ellipse_mask(shape, rig["head"]).astype(np.uint8) * 255
    blur = 9.0
    for strand in rig.get("strands", []):
        nodes = np.rint(strand["nodes"]).astype(np.int32)
        cv2.polylines(sample, [nodes], False, 255, max(3, round(strand["sigma"])))
        cv2.polylines(scope, [nodes], False, 255, max(3, round(strand["sigma"] * 6)))
        blur = max(blur, strand["max"] * 1.2)
    for bun in rig.get("buns", {}).values():
        scope[ellipse_mask(shape, bun)] = 255
        centre = {**bun, "rx": bun["rx"] * 0.5, "ry": bun["ry"] * 0.5}
        sample[ellipse_mask(shape, centre)] = 255
    scope = cv2.dilate(scope, np.ones((19, 19), np.uint8)) > 0
    excluded = np.zeros(shape, bool)
    for eye in rig["eyes"]:
        excluded |= polygon_mask(shape, eye["roi"]) > 0
    for key in ("brow", "mouth", "nose"):
        excluded |= ellipse_mask(shape, rig["face"][key])
    if rig.get("hand"):
        excluded |= polygon_mask(shape, rig["hand"]["outline"]) > 0
    opaque = rgba[..., 3] > 200
    lab = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2LAB).astype(np.float32)
    sampling = (sample > 0) & opaque & ~excluded
    pixels = lab[sampling]
    if not len(pixels):
        return np.zeros(shape, np.uint8)
    # Lab separates brown shadows from similarly dark, neutral clothing. Cluster
    # several shades rather than allowing one broad RGB tolerance to include both.
    pixels = pixels[pixels[:, 0] <= np.percentile(pixels[:, 0], 90)]

    def palette(values, count):
        # Regular subsampling bounds work and keeps the result deterministic.
        values = np.ascontiguousarray(
            values[:: max(1, len(values) // 12000)], np.float32
        )
        cv2.setRNGSeed(0)
        _, _, centres = cv2.kmeans(
            values,
            min(count, len(values)),
            None,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 40, 0.1),
            1,
            cv2.KMEANS_PP_CENTERS,
        )
        return centres

    def distance(colours, values):
        result = np.full(values.shape[:-1], np.inf, np.float32)
        for colour in colours:
            result = np.minimum(result, np.linalg.norm(values - colour, axis=-1))
        return result

    hair_colours = palette(pixels, 8)
    hair_distance = distance(hair_colours, lab)
    tolerance = max(
        16, min(35, np.percentile(distance(hair_colours, pixels), 95) * 1.5)
    )
    body = ellipse_mask(shape, rig["body"]["chest"])
    for shoulder in rig["body"]["shoulders"]:
        body |= ellipse_mask(shape, shoulder)
    negative = lab[body & ~scope & opaque]
    skin_colours = []
    for eye in rig["eyes"]:
        colour, _ = skin_samples(rgba, polygon_mask(shape, eye["roi"]))
        skin_colours.append(cv2.cvtColor(np.uint8([[colour]]), cv2.COLOR_RGB2LAB)[0, 0])
    other_colours = np.array(skin_colours, np.float32)
    if len(negative):
        other_colours = np.vstack([other_colours, palette(negative, 8)])
    other_distance = distance(other_colours, lab)
    not_hair = other_distance < hair_distance
    candidate = (hair_distance < tolerance) & scope & opaque & ~excluded & ~not_hair
    candidate = cv2.morphologyEx(
        candidate.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)
    )
    candidate[excluded | ~scope | ~opaque | not_hair] = 0
    _, labels = cv2.connectedComponents(candidate)
    seeded = np.unique(labels[sampling & (candidate > 0)])
    seeded = seeded[seeded != 0]
    mask = np.isin(labels, seeded).astype(np.uint8) * 255
    # Shadows/highlights enclosed by a hair component belong to the same hair.
    # Fill small colour-classification holes, while keeping skin and bright,
    # differently coloured accessories out of the inferred region.
    count, holes, stats, _ = cv2.connectedComponentsWithStats(
        (mask == 0).astype(np.uint8)
    )
    filled = np.zeros(shape, bool)
    max_hole = max(64, rig["head"]["rx"] * rig["head"]["ry"] * 0.03)
    for i in range(1, count):
        x, y, width, height, area = stats[i]
        if (
            x == 0
            or y == 0
            or x + width == shape[1]
            or y + height == shape[0]
            or area > max_hole
        ):
            continue
        filled |= (holes == i) & (hair_distance < tolerance * 2) & ~excluded & opaque
    mask[filled] = 255
    mask = cv2.GaussianBlur(mask, (0, 0), blur)
    mask[
        excluded
        | ~scope
        | (not_hair & ~filled)
        | (hair_distance >= tolerance * 2)
        | (rgba[..., 3] == 0)
    ] = 0
    return mask


def hand_prefill(rgba, remove, hand):
    """Continue the visible jaw through the hand, using only the rig's landmarks."""
    prefill = rgba.copy()
    yy, xx = np.mgrid[: rgba.shape[0], : rgba.shape[1]]
    jx, jy = np.array(hand["jaw"], float).T
    coef = np.polyfit(jx, jy, min(4, len(jx) - 1))
    curve = np.polyval(coef, xx)
    slope = np.polyval(np.polyder(coef), xx)
    dist = (yy - curve) / np.sqrt(1 + slope**2)
    in_x = (xx >= hand["jawRange"][0]) & (xx <= hand["jawRange"][1])
    hole = remove > 0
    bg_region = polygon_mask(rgba.shape[:2], hand["background"]) > 0
    face = hole & in_x & (dist < 0) & (yy > min(p[1] for p in hand["background"]))
    bg = hole & bg_region & (dist >= 0)
    filled = fill_skin(rgba, face.astype(np.uint8) * 255)
    prefill[face] = filled[face]
    prefill[bg] = (0, 0, 0, 0)
    colours, widths = [], []
    for x, y in hand["jaw"][:4] + hand["jaw"][-4:]:
        ix, iy = int(x), int(y)
        col = rgba[max(iy - 3, 0) : min(iy + 4, rgba.shape[0]), ix, :3].astype(
            np.float32
        )
        lum = luminance(col)
        colours.append(col[np.argmin(lum)])
        widths.append(max(1, np.count_nonzero(lum < (lum.min() + lum.max()) / 2)))
    line_col = np.median(colours, axis=0)
    half_width = np.median(widths) / 2
    lw = (np.clip(half_width + 0.5 - np.abs(dist), 0, 1) * (hole & in_x))[..., None]
    prefill[..., :3] = (prefill[..., :3] * (1 - lw) + line_col * lw).astype(np.uint8)
    prefill[..., 3] = np.maximum(prefill[..., 3], (lw[..., 0] * 255).astype(np.uint8))
    painted = (face | bg | (lw[..., 0] > 0)).astype(np.uint8) * 255 & remove
    return prefill, painted


def validate_inputs(rig, rgba):
    h, w = rgba.shape[:2]
    if rig.get("version") != 1 or rig.get("image") != {"width": w, "height": h}:
        raise ValueError(
            "rig.image must match source.png dimensions, with rig.version = 1"
        )
    if len(rig.get("eyes", [])) != 2:
        raise ValueError("rig.eyes must contain two eyes")

    def points(value, path, minimum=3):
        p = np.asarray(value, dtype=float)
        if (
            p.ndim != 2
            or p.shape[1] != 2
            or len(p) < minimum
            or not np.isfinite(p).all()
        ):
            raise ValueError(
                f"{path}: expected at least {minimum} finite [x, y] points"
            )
        if (
            (p[:, 0] < 0).any()
            or (p[:, 0] > w).any()
            or (p[:, 1] < 0).any()
            or (p[:, 1] > h).any()
        ):
            raise ValueError(f"{path}: points must be within source.png")
        if minimum >= 3 and cv2.contourArea(p.astype(np.float32)) <= 0:
            raise ValueError(f"{path}: polygon must have positive area")

    for i, eye in enumerate(rig["eyes"]):
        for key in ("opening", "roi"):
            points(eye[key], f"eyes[{i}].{key}")
        core = polygon_mask((h, w), eye["opening"])
        region = polygon_mask((h, w), eye["roi"])
        if not np.any((core > 0) & (region > 0)):
            raise ValueError(f"eyes[{i}].roi must overlap opening")
        if not np.any((core > 0) & (rgba[..., 3] > 0)):
            raise ValueError(f"eyes[{i}].opening has no source pixels")
        eye_curves(eye)
    for key in ("brow", "mouth", "nose"):
        region = rig["face"][key]
        if (
            not all(np.isfinite(region[k]) for k in ("cx", "cy", "rx", "ry"))
            or min(region["rx"], region["ry"]) <= 0
        ):
            raise ValueError(
                f"face.{key}: expected a finite ellipse with positive radii"
            )
    for i, strand in enumerate(rig.get("strands", [])):
        points(strand["nodes"], f"strands[{i}].nodes", 2)
        if any(not np.isfinite(strand[k]) or strand[k] <= 0 for k in ("sigma", "max")):
            raise ValueError(f"strands[{i}]: sigma and max must be positive")
    if rig.get("hand") is not None:
        hand = rig["hand"]
        points(hand["outline"], "hand.outline")
        points(hand["background"], "hand.background")
        points(hand["jaw"], "hand.jaw", 2)
        if len({p[0] for p in hand["jaw"]}) < 2:
            raise ValueError("hand.jaw needs different x coordinates")
        if (
            len(hand["jawRange"]) != 2
            or not 0 <= hand["jawRange"][0] < hand["jawRange"][1] <= w
        ):
            raise ValueError(
                "hand.jawRange must be an increasing range inside the image"
            )
    names = {
        "base",
        "hairmask",
        "hand",
        *(
            f"eye{i}_{part}"
            for i in range(2)
            for part in ("ball", "lash", "low", "crease")
        ),
    }
    for i, accessory in enumerate(rig.get("accessories", [])):
        name = accessory["name"]
        if (
            not isinstance(name, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]+", name)
            or name in names
        ):
            raise ValueError(
                f"accessories[{i}].name must be a unique, safe layer filename"
            )
        names.add(name)
        box = accessory["box"]
        if len(box) != 4 or any(
            not isinstance(n, (int, float)) or not math.isfinite(n) for n in box
        ):
            raise ValueError(f"accessories[{i}].box must contain four finite coordinates")
        if box[0] >= box[2] or box[1] >= box[3]:
            raise ValueError(f"accessories[{i}].box must have positive width and height")
        rounded = [
            max(0, min(w, math.floor(box[0]))),
            max(0, min(h, math.floor(box[1]))),
            max(0, min(w, math.ceil(box[2]))),
            max(0, min(h, math.ceil(box[3]))),
        ]
        if rounded[0] >= rounded[2] or rounded[1] >= rounded[3]:
            raise ValueError(f"accessories[{i}].box has no area inside the image")
        if rounded != box:
            print(f"accessories[{i}].box rounded outward and clipped: {box} -> {rounded}")
        accessory["box"] = rounded
        colour = accessory["color"]
        if not 0 <= colour["redness"] <= 1 or not 0 <= colour["minRed"] <= 255:
            raise ValueError(f"accessories[{i}].color thresholds are out of range")


def build(project, rig_path):
    source = project / "source.png"
    rig_bytes = rig_path.read_bytes()
    rig = json.loads(rig_bytes)
    with Image.open(source) as image:
        rgba = np.array(image.convert("RGBA"))
    validate_inputs(rig, rgba)
    rgba[..., 3] = np.where(rgba[..., 3] > 240, 255, rgba[..., 3])
    h, w = rgba.shape[:2]
    build_id = hashlib.sha256(
        source.read_bytes() + rig_bytes + Path(__file__).read_bytes()
    ).hexdigest()[:12]
    meta = {"size": [w, h], "build": build_id, "layers": {}}
    images = {}

    def store(name, image, rect):
        images[name] = image
        meta["layers"][name] = rect

    remove = np.zeros((h, w), np.uint8)
    accessory_bg = np.zeros((h, w), np.uint8)
    hand = rig.get("hand")
    if hand is not None:
        mask = polygon_mask((h, w), hand["outline"])
        store("hand", *crop_layer(rgba, mask))
        remove |= cv2.dilate(mask, np.ones((5, 5), np.uint8))
        tips = cv2.dilate(mask, np.ones((11, 11), np.uint8))
        cutoff = int(max(p[1] for p in hand["jaw"]) + 20)
        tips[max(cutoff, 0) :] = 0
        remove |= tips
    for accessory in rig.get("accessories", []):
        mask = accessory_mask(rgba, accessory)
        if not np.any(mask):
            raise ValueError(
                f"accessory {accessory['name']}: no pixels match its box and color thresholds"
            )
        store(accessory["name"], *crop_layer(rgba, mask))
        accessory_bg |= cv2.dilate(mask, np.ones((5, 5), np.uint8))

    eye_hole = np.zeros((h, w), np.uint8)
    eye_parts = []
    for i, eye in enumerate(rig["eyes"]):
        ball, lash, low, crease, stray, core, white = eye_classes(rgba, eye)
        taken = cv2.erode(core, np.ones((3, 3), np.uint8))
        lines, inks = {}, {}
        region = polygon_mask((h, w), eye["roi"])
        skin, _ = skin_samples(rgba, region)
        for part, mask in (("lash", lash), ("low", low), ("crease", crease)):
            inks[part] = infer_ink(rgba, mask, skin)
            grown = cv2.dilate(mask, np.ones((5, 5), np.uint8)) & ~taken
            lines[part] = grown & cv2.dilate(region, np.ones((5, 5), np.uint8))
            taken |= lines[part]
        eye_parts.append((i, ball, lines, inks))
        near = cv2.dilate(core, np.ones((15, 15), np.uint8)) & ~core
        eye_hole |= taken | core | stray | (white.astype(np.uint8) * 255 & near)
        eye.update(eye_curves(eye))
    skin_under = fill_skin(rgba, eye_hole)[..., :3]
    for i, ball, lines, inks in eye_parts:
        store(f"eye{i}_ball", *crop_layer(rgba, ball, pad=3, soft=False))
        for part, mask in lines.items():
            full = unblend(rgba, skin_under, mask, inks[part])
            edge = np.clip(
                cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 0.7) * 1.6, 0, 1
            )
            full[..., 3] = (full[..., 3] * edge).astype(np.uint8)
            store(
                f"eye{i}_{part}",
                *crop_layer(
                    full, (full[..., 3] > 0).astype(np.uint8) * 255, pad=2, soft=False
                ),
            )
    meta["eyes"] = [
        {k: eye[k] for k in ("x0", "x1", "top", "bot")} for eye in rig["eyes"]
    ]
    meta["version"] = 1

    prefill, painted = (
        hand_prefill(rgba, remove, hand) if hand else (rgba, np.zeros_like(remove))
    )
    base = inpaint_rgba(prefill, (remove & ~painted) | accessory_bg | eye_hole)
    base = fill_skin(base, eye_hole)
    if np.any(accessory_bg):
        kept = ((rgba[..., 3] > 128) & (accessory_bg == 0)).astype(np.uint8)
        dist = cv2.distanceTransform(1 - kept, cv2.DIST_L2, 5)
        fade = np.clip(1 - dist / 2.5, 0, 1)
        base[..., 3] = np.where(
            accessory_bg > 0, (base[..., 3] * fade).astype(np.uint8), base[..., 3]
        )
    images["base"] = base
    images["hairmask"] = hair_mask(rgba, rig)

    # Calculate everything before replacing files. Keep sprites and unrelated
    # assets intact; only filenames in this build's manifest are consumed.
    with tempfile.TemporaryDirectory(prefix=".build-layers-", dir=project) as temporary:
        stage = Path(temporary)
        for name, img in images.items():
            Image.fromarray(img).save(stage / f"{name}.png")
        (stage / "layers.json").write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8"
        )
        (stage / "rig.json").write_text(
            json.dumps(rig, indent=2) + "\n", encoding="utf-8"
        )
        out = project / "built"
        out.mkdir(exist_ok=True)
        for name in images:
            (stage / f"{name}.png").replace(out / f"{name}.png")
        (stage / "layers.json").replace(out / "layers.json")
        (stage / "rig.json").replace(project / "rig.json")
    print(
        json.dumps({"build": build_id, "size": [w, h], "layers": list(meta["layers"])})
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "project_dir", type=Path, help="Folder containing source.png and a rig"
    )
    parser.add_argument(
        "--rig",
        default="rig.json",
        help="Rig filename relative to project-dir (default: rig.json)",
    )
    args = parser.parse_args()
    try:
        build(args.project_dir, args.project_dir / args.rig)
    except (OSError, ValueError, KeyError, TypeError, cv2.error) as error:
        print(f"build-layers: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
