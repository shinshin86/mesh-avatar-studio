"""Run with the same uv --with dependencies as build-layers.py."""

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "build-layers.py"
spec = importlib.util.spec_from_file_location("build_layers", SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildLayersTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        self.rig = json.loads((ROOT / "samples/miko-qipao/rig.json").read_text())
        self.rig["image"] = {"width": 100, "height": 80}
        for key in ("hand", "buns", "accessories", "strands"):
            self.rig.pop(key, None)
        self.rig["eyes"] = []
        image = Image.new("RGBA", (100, 80), (190, 210, 230, 255))
        draw = ImageDraw.Draw(image)
        for left in (15, 65):
            opening = [[left, 28], [left + 15, 28], [left + 15, 36], [left, 36]]
            roi = [[left - 4, 20], [left + 19, 20], [left + 19, 40], [left - 4, 40]]
            self.rig["eyes"].append({"opening": opening, "roi": roi})
            draw.rectangle((left, 28, left + 15, 36), fill=(255, 255, 255, 255))
            draw.line((left, 27, left + 15, 27), fill=(15, 25, 50, 255), width=2)
        image.save(self.project / "source.png")
        self.draft = self.project / "rig.draft.json"
        self.draft.write_text(json.dumps(self.rig))

    def run_cli(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(self.project), "--rig", "rig.draft.json"],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_draft_build_is_loadable_without_optional_parts_or_eye_curves(self):
        before = self.draft.read_bytes()
        sprites = self.project / "built/sprites"
        sprites.mkdir(parents=True)
        (sprites / "keep.txt").write_text("keep")
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.draft.read_bytes(), before)
        self.assertEqual((sprites / "keep.txt").read_text(), "keep")
        meta = json.loads((self.project / "built/layers.json").read_text())
        self.assertEqual(meta["version"], 1)
        self.assertEqual(list(meta), ["size", "build", "layers", "eyes", "version"])
        rig = json.loads((self.project / "rig.json").read_text())
        self.assertEqual(len(meta["layers"]), 8)
        self.assertNotIn("hand", meta["layers"])
        for eye in rig["eyes"]:
            self.assertEqual(len(eye["top"]), 24)
            self.assertEqual(len(eye["bot"]), 24)
            self.assertTrue(all(top <= bot for top, bot in zip(eye["top"], eye["bot"])))
        for name, (x, y, width, height) in meta["layers"].items():
            self.assertGreater(width, 0)
            self.assertGreater(height, 0)
            self.assertTrue(0 <= x < x + width <= 100 and 0 <= y < y + height <= 80)
            with Image.open(self.project / "built" / f"{name}.png") as image:
                self.assertEqual(image.size, (width, height))
        with Image.open(self.project / "built/hairmask.png") as image:
            self.assertEqual(image.getextrema(), (0, 0))
        self.assertEqual(rig["eyes"][0]["x0"], 15)
        self.assertEqual(rig["eyes"][0]["x1"], 30)
        # An absent crease still has a valid transparent texture for the engine.
        with Image.open(self.project / "built/eye0_crease.png") as image:
            crease = np.array(image)
        self.assertEqual(int(crease[..., 3].max()), 0)

    def test_invalid_geometry_does_not_replace_existing_output(self):
        (self.project / "rig.json").write_text("existing rig")
        (self.project / "built").mkdir()
        (self.project / "built/layers.json").write_text("existing layers")
        cases = []
        dimensions = copy.deepcopy(self.rig)
        dimensions["image"]["width"] = 101
        cases.append(dimensions)
        polygon = copy.deepcopy(self.rig)
        polygon["eyes"][0]["opening"] = [[15, 28], [15, 28], [15, 28]]
        cases.append(polygon)
        escaping = copy.deepcopy(self.rig)
        escaping["accessories"] = [{"name": "../escape"}]
        cases.append(escaping)
        for rig in cases:
            with self.subTest(rig=rig):
                self.draft.write_text(json.dumps(rig))
                result = self.run_cli()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("build-layers:", result.stderr)
                self.assertEqual(
                    (self.project / "rig.json").read_text(), "existing rig"
                )
                self.assertEqual(
                    (self.project / "built/layers.json").read_text(), "existing layers"
                )

    def test_accessory_boxes_round_outward_clip_and_keep_valid_integers(self):
        for box, expected in [
            ([10.2, 20.8, 30.1, 40.2], [10, 20, 31, 41]),
            ([-5.2, -3.1, 101.7, 81.2], [0, 0, 100, 80]),
            ([10, 20, 30, 40], [10, 20, 30, 40]),
        ]:
            with self.subTest(box=box):
                self.rig["accessories"] = [{"name": "tassel", "box": box, "color": {"redness": 0.5, "minRed": 60}}]
                # Add source pixels that satisfy the accessory's colour thresholds.
                with Image.open(self.project / "source.png") as original:
                    image = original.convert("RGBA")
                ImageDraw.Draw(image).rectangle((22, 21, 25, 25), fill=(220, 30, 30, 255))
                image.save(self.project / "source.png")
                self.draft.write_text(json.dumps(self.rig))
                result = self.run_cli()
                self.assertEqual(result.returncode, 0, result.stderr)
                saved = json.loads((self.project / "rig.json").read_text())
                self.assertEqual(saved["accessories"][0]["box"], expected)
                self.assertTrue(all(isinstance(n, int) for n in saved["accessories"][0]["box"]))
                if expected != box:
                    self.assertIn("rounded outward and clipped", result.stdout)
                else:
                    self.assertNotIn("rounded outward and clipped", result.stdout)

    def test_collapsed_or_nonfinite_boxes_fail_without_replacing_output(self):
        (self.project / "rig.json").write_text("existing rig")
        (self.project / "built").mkdir()
        (self.project / "built/layers.json").write_text("existing layers")
        for box in [[101, 20, 110, 40], [20, 80, 30, 90], [20, 20, 20, 40], [30.5, 20, 30.4, 40], [float("nan"), 20, 30, 40]]:
            with self.subTest(box=box):
                self.rig["accessories"] = [{"name": "tassel", "box": box, "color": {"redness": 0.5, "minRed": 60}}]
                self.draft.write_text(json.dumps(self.rig))
                result = self.run_cli()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("accessories[0].box", result.stderr)
                self.assertEqual((self.project / "rig.json").read_text(), "existing rig")
                self.assertEqual((self.project / "built/layers.json").read_text(), "existing layers")

    def test_sampled_eye_curves_match_existing_fixture(self):
        rig = json.loads((ROOT / "samples/miko-qipao/rig.json").read_text())
        for eye in rig["eyes"]:
            sampled = builder.eye_curves(eye)
            for key in ("x0", "x1", "top", "bot"):
                np.testing.assert_array_equal(sampled[key], eye[key])

    def test_hair_reaches_buns_and_sides_without_skin_clothes_or_bright_accessories(
        self,
    ):
        image = Image.new("RGBA", (100, 80), (240, 210, 190, 255))
        draw = ImageDraw.Draw(image)
        hair = (70, 40, 30, 255)
        draw.polygon(
            [
                (15, 5),
                (85, 5),
                (90, 20),
                (85, 50),
                (75, 50),
                (75, 15),
                (25, 15),
                (25, 50),
                (15, 50),
                (10, 20),
            ],
            fill=hair,
        )
        draw.ellipse((-2, 3, 16, 21), fill=hair)
        draw.rectangle((25, 55, 75, 79), fill=(45, 45, 45, 255))
        draw.line((25, 9, 75, 9), fill=(100, 255, 255, 255), width=2)
        draw.rectangle((84, 1, 87, 25), fill=(255, 120, 255, 255))
        rig = copy.deepcopy(self.rig)
        rig["head"] = {"cx": 50, "cy": 30, "rx": 42, "ry": 30}
        rig["buns"] = {"bunL": {"cx": 7, "cy": 12, "rx": 9, "ry": 9}}
        rig["strands"] = [{"nodes": [[40, 6], [60, 6]], "sigma": 3, "max": 3}]
        rig["body"] = {
            "chest": {"cx": 50, "cy": 68, "rx": 20, "ry": 12},
            "shoulders": [],
        }
        for name in ("brow", "mouth", "nose"):
            rig["face"][name] = {"cx": 50, "cy": 45, "rx": 4, "ry": 4}
        mask = builder.hair_mask(np.array(image), rig)
        for y, x in [(12, 7), (45, 20), (45, 80), (6, 60)]:
            self.assertGreater(int(mask[y, x]), 50, (y, x))
        for y, x in [(68, 50), (48, 50), (9, 50), (12, 85)]:
            self.assertEqual(int(mask[y, x]), 0, (y, x))


if __name__ == "__main__":
    unittest.main()
