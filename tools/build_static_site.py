from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

PUBLIC_FILES = [
    "index.html",
    "database.html",
    "learning.html",
    "services.html",
    "styles.css",
    "script.js",
    "robots.txt",
    "sitemap.xml",
]

PUBLIC_DIRS = [
    "assets",
    "data",
]


def copy_file(relative_path: str) -> None:
    source = ROOT / relative_path
    target = DIST / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def ignore_private_files(directory: str, names: list[str]) -> set[str]:
    ignored = {"__pycache__"}
    if directory.endswith("data"):
        ignored.add("site-data.js")
        ignored.add("TCRshows-db.xlsx")
    return ignored.intersection(names)


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    for relative_path in PUBLIC_FILES:
        copy_file(relative_path)

    for relative_dir in PUBLIC_DIRS:
        shutil.copytree(
            ROOT / relative_dir,
            DIST / relative_dir,
            ignore=ignore_private_files,
            dirs_exist_ok=True,
        )


if __name__ == "__main__":
    main()
