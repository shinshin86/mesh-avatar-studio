# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.4", "numpy", "opencv-python-headless"]
# ///
"""Test calibration scoring, private project boundaries and variant rejection."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from agent_common import ROOT, edit_masks, grid_image
from PIL import Image


def module(filename):
    spec = importlib.util.spec_from_file_location(
        filename.replace("-", "_"), ROOT / "tools" / f"{filename}.py"
    )
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


sprites = module("build-sprites")
new = module("new-project")


class AgentToolsTest(unittest.TestCase):
    def setUp(self):
        (ROOT / "projects").mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(
            prefix="tool-check-", dir=ROOT / "projects"
        )
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        image = Image.new("RGBA", (100, 100), (210, 190, 175, 255))
        image.save(self.project / "source.png")
        self.rig = {
            "image": {"width": 100, "height": 100},
            "eyes": [
                {"roi": [[10, 20], [30, 20], [30, 40], [10, 40]]},
                {"roi": [[60, 20], [80, 20], [80, 40], [60, 40]]},
            ],
            "mouth": {"area": {"cx": 50, "cy": 65, "rx": 15, "ry": 8, "angle": 0}},
        }
        (self.project / "rig.json").write_text(json.dumps(self.rig))

    def cli(self, name, *args):
        return subprocess.run(
            [sys.executable, str(ROOT / "tools" / f"{name}.py"), *map(str, args)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_calibration_round_trip_and_bad_or_missing_answers(self):
        folder = self.project / "calibration"
        self.assertEqual(self.cli("vision-check", "make", folder).returncode, 0)
        # This is an automated scorer test, not the agent's visual calibration.
        key = json.loads((folder / ".key.json").read_text())
        answer = self.project / "answer.json"
        answer.write_text(json.dumps(key))
        self.assertEqual(
            self.cli("vision-check", "score", folder, answer).returncode, 0
        )
        key["1"][0] += 40
        answer.write_text(json.dumps(key))
        result = self.cli("vision-check", "score", folder, answer)
        self.assertEqual(result.returncode, 1)
        self.assertIn("FAIL", result.stdout)
        key.pop("1")
        answer.write_text(json.dumps(key))
        self.assertEqual(
            self.cli("vision-check", "score", folder, answer).returncode, 1
        )

    def test_grid_region_dimensions_and_invalid_input(self):
        with Image.open(self.project / "source.png") as image:
            result, transform = grid_image(image, [10, 20, 50, 60], 5)
            self.assertEqual(result.size, (964, 938))
            self.assertEqual(transform([10, 20]), (64, 38))
            with self.assertRaises(ValueError):
                grid_image(image, step=0)
            with self.assertRaises(ValueError):
                grid_image(image, [-1, 0, 50, 60])

    def test_new_project_warns_and_refuses_replacement_or_unsafe_names(self):
        name = self.project.name + "-new"
        created = ROOT / "projects" / name
        # Keep cleanup confined to this test's freshly created directory.
        self.addCleanup(module_cleanup, created)
        rgb = self.project / "opaque.png"
        Image.new("RGB", (100, 100)).save(rgb)
        result = self.cli("new-project", rgb, name)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no alpha", result.stderr)
        self.assertIn("800", result.stderr)
        manifest = created / "avatar.json"
        self.assertEqual(json.loads(manifest.read_text()), {
            "format": "mesh-avatar", "version": 1, "name": name,
        })
        before = (created / "rig.draft.json").read_bytes()
        self.assertEqual(self.cli("new-project", rgb, name).returncode, 1)
        self.assertEqual((created / "rig.draft.json").read_bytes(), before)
        manifest.write_text(json.dumps({"format": "mesh-avatar", "version": 1, "name": "Custom name", "author": "Artist"}))
        manifest_before = manifest.read_bytes()
        self.assertEqual(self.cli("new-project", rgb, name, "--force").returncode, 0)
        self.assertEqual(manifest.read_bytes(), manifest_before)
        with self.assertRaises(ValueError):
            new.create(rgb, "../escape")
        wrong = self.project / "source.jpg"
        Image.new("RGB", (100, 100)).save(wrong)
        self.assertEqual(self.cli("new-project", wrong, name, "--force").returncode, 1)

    def test_variants_cover_only_regions_and_missing_variants_are_clean(self):
        eyes, mouth = edit_masks(self.rig, (100, 100))
        self.assertEqual(int(eyes[0][30, 20]), 1)
        self.assertEqual(int(eyes[1][30, 70]), 1)
        self.assertEqual(int(eyes[0][65, 50]), 0)
        self.assertEqual(int(mouth[65, 50]), 1)
        self.assertEqual(int(mouth[30, 20]), 0)
        result = self.cli("variant-requests", self.project)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            len(list((self.project / "variant-requests").glob("*/mask.png"))), 7
        )
        self.assertEqual(self.cli("build-sprites", self.project).returncode, 0)
        self.assertFalse((self.project / "built").exists())
        self.rig["eyes"][0]["roi"] = []
        with self.assertRaisesRegex(ValueError, r"eyes\[0\].roi"):
            edit_masks(self.rig, (100, 100))

    def test_size_and_outside_changes_reject_without_replacing_outputs(self):
        variants = self.project / "variants"
        variants.mkdir()
        path = variants / "mouth_a.png"
        with Image.open(self.project / "source.png") as image:
            valid = image.copy()
        valid.putpixel((50, 65), (30, 0, 0, 255))
        valid.save(path)
        sprites.build(self.project)
        metadata = self.project / "built/sprites/sprites.json"
        before = metadata.read_bytes()
        self.assertEqual(json.loads(before)["version"], 1)
        self.assertEqual(list(json.loads(before)), ["build", "layers", "version"])
        self.assertEqual(json.loads(before)["layers"]["mouth_a"][2] > 0, True)
        invalid = valid.copy()
        invalid.putpixel((0, 0), (0, 0, 0, 255))
        invalid.save(path)
        with self.assertRaisesRegex(ValueError, "outside-mask"):
            sprites.build(self.project)
        self.assertEqual(metadata.read_bytes(), before)
        Image.new("RGBA", (99, 100)).save(path)
        with self.assertRaisesRegex(ValueError, "size"):
            sprites.build(self.project)
        self.assertEqual(metadata.read_bytes(), before)


def module_cleanup(path):
    import shutil

    shutil.rmtree(path)


if __name__ == "__main__":
    unittest.main()
