from __future__ import annotations

import re


def is_valid_package_name(value: str) -> bool:
    return bool(re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+', value))


def is_valid_version_code(value: str) -> bool:
    return bool(re.fullmatch(r'\d+', value))


def to_safe_file_stem(value: str) -> str:
    normalized = re.sub(r'[\\/:*?"<>|]', '-', value.strip())
    normalized = re.sub(r'\s+', ' ', normalized)[:80]
    return normalized or 'modded'
