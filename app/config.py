from __future__ import annotations

import os
from pathlib import Path


def _first_existing_path(paths: list[str]) -> str | None:
    for item in paths:
        if Path(item).exists():
            return item
    return None


def _detect_build_tool(tool_name: str) -> str:
    root = Path('/opt/homebrew/share/android-commandlinetools/build-tools')
    if not root.exists():
        return tool_name

    versions = sorted(
        [x for x in root.iterdir() if x.is_dir() and x.name.count('.') == 2 and all(p.isdigit() for p in x.name.split('.'))],
        key=lambda p: p.name,
        reverse=True,
    )
    for version in versions:
        candidate = version / tool_name
        if candidate.exists():
            return str(candidate)
    return tool_name


PORT = int(os.getenv('PORT', '3000'))
HOST = os.getenv('HOST', '127.0.0.1')

DATA_ROOT = Path(os.getcwd()) / 'data'
UPLOAD_DIR = DATA_ROOT / 'uploads'
MOD_UPLOAD_DIR = DATA_ROOT / 'mod-uploads'
WORK_DIR_ROOT = DATA_ROOT / 'work'

APKTOOL_PATH = os.getenv('APKTOOL_PATH', 'apktool')
ZIPALIGN_PATH = os.getenv('ZIPALIGN_PATH', _detect_build_tool('zipalign'))
APKSIGNER_PATH = os.getenv('APKSIGNER_PATH', _detect_build_tool('apksigner'))

KEYTOOL_PATH = os.getenv(
    'KEYTOOL_PATH',
    _first_existing_path(
        [
            '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/keytool',
            '/usr/bin/keytool',
        ]
    )
    or 'keytool',
)
JAVA_PATH = os.getenv(
    'JAVA_PATH',
    _first_existing_path(
        [
            '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java',
            '/usr/bin/java',
        ]
    )
    or 'java',
)

JAVA_HOME = os.getenv('JAVA_HOME', str(Path(JAVA_PATH).parent.parent))

DEBUG_KEYSTORE_PATH = DATA_ROOT / 'debug.keystore'
DEBUG_ALIAS = os.getenv('DEBUG_KEY_ALIAS', 'androiddebugkey')
DEBUG_PASS = os.getenv('DEBUG_KEY_PASS', 'android')
API_KEY = os.getenv('API_KEY') or os.getenv('AUTH_TOKEN', '')
AUTH_ENABLED = len(API_KEY) > 0

FRONTEND_PUBLIC_DIR = Path(os.getcwd()) / 'public'


def ensure_runtime_dirs() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    MOD_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    WORK_DIR_ROOT.mkdir(parents=True, exist_ok=True)
