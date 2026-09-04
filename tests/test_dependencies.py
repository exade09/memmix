from __future__ import annotations

import ast
import pathlib
import sys
import tomllib
import unittest


PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL_PACKAGES = {"axiom_scanner", "vercel_api", "api", "tests", "main", "conftest"}
SKIP_DIRS = {"node_modules", ".venv", "venv", "dist", "web", ".git"}


def _requirements() -> list[str]:
    text = (PROJECT_ROOT / "requirements.txt").read_text(encoding="utf-8")
    return [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")]


def _declared() -> list[str]:
    data = tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    return list(data.get("project", {}).get("dependencies", []))


def _third_party_imports() -> set[str]:
    found: set[str] = set()
    for path in PROJECT_ROOT.rglob("*.py"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            for name in names:
                top = name.split(".")[0]
                if top not in sys.stdlib_module_names and top not in LOCAL_PACKAGES:
                    found.add(top)
    return found


class DependencyDeclarationTests(unittest.TestCase):
    """
    Production installs what pyproject.toml declares; local development
    installs requirements.txt. Pillow was in one and not the other, so every
    avatar upload failed in production with MISSING_PILLOW while the whole
    test suite passed locally. These tests are the thing that would have
    caught that.
    """

    def test_requirements_and_pyproject_agree(self) -> None:
        self.assertEqual(sorted(_requirements()), sorted(_declared()))

    def test_every_third_party_import_is_declared(self) -> None:
        # Import name -> distribution name, where they differ.
        distribution_for = {
            "PIL": "pillow",
            "eth_abi": "eth-abi",
            "eth_account": "eth-account",
            "eth_utils": "eth-utils",
        }
        declared = {
            spec.split(">")[0].split("<")[0].split("=")[0].split("[")[0].strip().lower()
            for spec in _declared()
        }
        for module in _third_party_imports():
            with self.subTest(module=module):
                name = distribution_for.get(module, module).lower()
                self.assertIn(name, declared, f"{module} is imported but not declared as a dependency")

    def test_pillow_is_actually_importable(self) -> None:
        """The failure in production was an ImportError, not a config typo."""
        from PIL import Image  # noqa: F401


if __name__ == "__main__":
    unittest.main()
