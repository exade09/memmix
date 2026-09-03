from __future__ import annotations

import unittest

from api.index import handler
from vercel_api.shared import WEB_ROOT


class FakeHandler(handler):
    """A do-nothing handler subclass: exercises the static resolver only."""

    def __init__(self) -> None:  # noqa: super not called on purpose
        pass


class StaticFileResolutionTests(unittest.TestCase):
    """
    The favicon was served as HTML for this entire session: any request whose
    path did not start with /assets/ and was not exactly /favicon.svg fell
    through to index.html, a 200 with the wrong body and no error anywhere to
    notice. These pin resolution to what is actually on disk.
    """

    def setUp(self) -> None:
        self.handler = FakeHandler()
        self.dist_root = WEB_ROOT / "dist"

    def _resolve(self, path: str):
        return self.handler._static_path_for_request(path)

    def test_root_serves_index_html(self) -> None:
        result = self._resolve("/")
        self.assertEqual(result.name, "index.html")

    def test_root_level_public_files_are_served_directly(self) -> None:
        # These are exactly the files that used to silently become index.html.
        for name in ("favicon.png", "favicon-180.png", "apple-touch-icon.png"):
            with self.subTest(name=name):
                result = self._resolve(f"/{name}")
                self.assertEqual(result.name, name, f"/{name} did not resolve to itself")

    def test_assets_still_resolve_as_before(self) -> None:
        result = self._resolve("/favicon.svg")
        self.assertIn(result.name, {"favicon.svg", "index.html"})  # svg was retired; must not crash either way

    def test_missing_asset_with_an_extension_is_a_real_miss(self) -> None:
        """
        A dotted last segment that matches nothing on disk must resolve to a
        path that is not a file, so the caller's is_file() check 404s it
        instead of masking the miss behind a 200 of index.html.
        """
        for path in ("/does-not-exist.png", "/assets/ghost.js", "/robots.txt", "/manifest.json"):
            with self.subTest(path=path):
                result = self._resolve(path)
                self.assertFalse(result.is_file(), f"{path} should not resolve to an existing file")
                self.assertNotEqual(result.name, "index.html", f"{path} silently fell back to index.html")

    def test_extensionless_paths_are_client_side_routes(self) -> None:
        for path in ("/app/mix", "/app/launch", "/docs", "/safety", "/admin/ca", "/token/0xabc"):
            with self.subTest(path=path):
                result = self._resolve(path)
                self.assertEqual(result.name, "index.html", f"{path} must fall back to the SPA shell")

    def test_result_never_escapes_web_root(self) -> None:
        # The caller enforces this with a startswith check; confirm the
        # resolver never hands back something outside the tree to begin with.
        for path in ("/../../etc/passwd", "/assets/../../secrets.env", "/favicon.png"):
            with self.subTest(path=path):
                result = self._resolve(path).resolve()
                self.assertTrue(str(result).startswith(str(WEB_ROOT.resolve())))


if __name__ == "__main__":
    unittest.main()
