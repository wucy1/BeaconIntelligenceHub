#!/usr/bin/env python3
"""Merge locale JSON files so every bundle has all keys from en.json."""

from __future__ import annotations

import json
from pathlib import Path

LOCALES_DIR = Path(__file__).resolve().parents[1] / "src" / "i18n" / "locales"


def load(path: Path) -> dict[str, str]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save(path: Path, data: dict[str, str]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def merge_locale(name: str, en: dict[str, str], zh_hant: dict[str, str], existing: dict[str, str]) -> dict[str, str]:
    merged: dict[str, str] = {}
    for key in sorted(en.keys()):
        if name == "zh-Hant.json":
            merged[key] = existing.get(key, en[key])
        elif name == "zh.json":
            merged[key] = existing.get(key) or zh_hant.get(key) or en[key]
        else:
            merged[key] = existing.get(key, en[key])
    return merged


def main() -> None:
    en = load(LOCALES_DIR / "en.json")
    zh_hant = load(LOCALES_DIR / "zh-Hant.json")
    for path in sorted(LOCALES_DIR.glob("*.json")):
        if path.name == "en.json":
            continue
        existing = load(path)
        merged = merge_locale(path.name, en, zh_hant, existing)
        save(path, merged)
        print(f"{path.name}: {len(merged)} keys")


if __name__ == "__main__":
    main()
