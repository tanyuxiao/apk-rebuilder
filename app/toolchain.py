from __future__ import annotations

import os
import subprocess

from app.config import APKTOOL_PATH, APKSIGNER_PATH, JAVA_HOME, JAVA_PATH, KEYTOOL_PATH, ZIPALIGN_PATH


def _run(command: str, args: list[str], allowed_exit_codes: set[int] | None = None) -> tuple[bool, str]:
    allowed = allowed_exit_codes or set()
    env = dict(os.environ)
    env['JAVA_HOME'] = JAVA_HOME
    try:
        proc = subprocess.run(
            [command, *args],
            capture_output=True,
            text=True,
            env=env,
            check=True,
        )
        detail = (proc.stdout or proc.stderr or 'ok').splitlines()[0:1]
        return True, (detail[0] if detail else 'ok')
    except subprocess.CalledProcessError as exc:
        if exc.returncode in allowed:
            detail = (exc.stdout or exc.stderr or 'ok').splitlines()[0:1]
            return True, (detail[0] if detail else 'ok')
        detail = (exc.stdout or exc.stderr or str(exc)).strip()
        return False, detail.splitlines()[0] if detail else str(exc)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def run_command(command: str, args: list[str]) -> None:
    env = dict(os.environ)
    env['JAVA_HOME'] = JAVA_HOME
    subprocess.run([command, *args], env=env, check=True)


def get_toolchain_status() -> dict:
    if APKTOOL_PATH.endswith('.jar'):
        apktool_ok, apktool_detail = _run(JAVA_PATH, ['-jar', APKTOOL_PATH, '--version'])
    else:
        apktool_ok, apktool_detail = _run(APKTOOL_PATH, ['--version'])

    zipalign_ok, zipalign_detail = _run(ZIPALIGN_PATH, ['--version'], {2})
    if not zipalign_ok:
        zipalign_ok = True
        zipalign_detail = f'optional fallback enabled ({zipalign_detail})'

    apksigner_ok, apksigner_detail = _run(APKSIGNER_PATH, ['--version'], {1, 2})
    keytool_ok, keytool_detail = _run(KEYTOOL_PATH, ['-help'])
    java_ok, java_detail = _run(JAVA_PATH, ['-version'])

    return {
        'tools': {
            'apktool': {'command': APKTOOL_PATH, 'ok': apktool_ok, 'detail': apktool_detail},
            'zipalign': {'command': ZIPALIGN_PATH, 'ok': zipalign_ok, 'detail': zipalign_detail},
            'apksigner': {'command': APKSIGNER_PATH, 'ok': apksigner_ok, 'detail': apksigner_detail},
            'keytool': {'command': KEYTOOL_PATH, 'ok': keytool_ok, 'detail': keytool_detail},
            'java': {'command': JAVA_PATH, 'ok': java_ok, 'detail': java_detail},
        }
    }
