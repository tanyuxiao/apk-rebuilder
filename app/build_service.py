from __future__ import annotations

from pathlib import Path

from app.config import (
    APKTOOL_PATH,
    APKSIGNER_PATH,
    DEBUG_ALIAS,
    DEBUG_KEYSTORE_PATH,
    DEBUG_PASS,
    JAVA_PATH,
    KEYTOOL_PATH,
    ZIPALIGN_PATH,
)
from app.manifest_service import apply_icon_replacement, parse_apk_info, update_manifest
from app.models import ModPayload, Task
from app.task_store import log_task, set_task_error
from app.toolchain import run_command
from app.unity_config_service import apply_unity_patches


def _ensure_debug_keystore(task: Task) -> None:
    if DEBUG_KEYSTORE_PATH.exists():
        return
    log_task(task, 'Create debug keystore')
    run_command(
        KEYTOOL_PATH,
        [
            '-genkeypair',
            '-v',
            '-keystore',
            str(DEBUG_KEYSTORE_PATH),
            '-storepass',
            DEBUG_PASS,
            '-alias',
            DEBUG_ALIAS,
            '-keypass',
            DEBUG_PASS,
            '-keyalg',
            'RSA',
            '-keysize',
            '2048',
            '-validity',
            '10000',
            '-dname',
            'CN=Android Debug,O=Android,C=US',
        ],
    )


def _try_zipalign(task: Task, unsigned_apk_path: Path, aligned_apk_path: Path) -> None:
    log_task(task, 'Run zipalign')
    try:
        run_command(ZIPALIGN_PATH, ['-f', '4', str(unsigned_apk_path), str(aligned_apk_path)])
    except Exception as exc:  # noqa: BLE001
        log_task(task, f'zipalign unavailable, fallback to unaligned signing: {exc}')
        aligned_apk_path.write_bytes(unsigned_apk_path.read_bytes())


def run_decompile_task(task: Task) -> None:
    task.status = 'processing'
    task.error = None
    log_task(task, 'Start apktool decompile')

    out_dir = Path(task.workDir) / 'decoded'
    task.decodedDir = str(out_dir)
    Path(task.workDir).mkdir(parents=True, exist_ok=True)

    try:
        decode_args = ['d', '--no-src', '-f', task.filePath, '-o', str(out_dir)]
        if APKTOOL_PATH.endswith('.jar'):
            run_command(JAVA_PATH, ['-jar', APKTOOL_PATH, *decode_args])
        else:
            run_command(APKTOOL_PATH, decode_args)

        parse_apk_info(task)
        task.status = 'success'
        log_task(task, 'Decompile finished')
    except Exception as exc:  # noqa: BLE001
        set_task_error(task, exc, 'Decompile failed')


def run_mod_task(task: Task, payload: ModPayload) -> None:
    task.status = 'processing'
    task.error = None
    log_task(task, 'Start mod workflow')

    try:
        icon_ref: str | None = None
        if payload.iconUploadPath:
            ext = Path(payload.iconUploadPath).suffix.lower() or '.png'
            icon_ref = apply_icon_replacement(task, payload.iconUploadPath, ext)
        update_manifest(task, payload, icon_ref)
        apply_unity_patches(task, payload)
    except Exception as exc:  # noqa: BLE001
        set_task_error(task, exc, 'Manifest update failed')
        return

    try:
        unsigned_apk_path = Path(task.workDir) / 'unsigned.apk'
        aligned_apk_path = Path(task.workDir) / 'aligned.apk'
        signed_apk_path = Path(task.workDir) / 'signed.apk'
        task.unsignedApkPath = str(unsigned_apk_path)
        task.alignedApkPath = str(aligned_apk_path)
        task.signedApkPath = str(signed_apk_path)

        if not task.decodedDir:
            raise RuntimeError('Decoded directory is missing')

        log_task(task, 'Build apk with apktool')
        if APKTOOL_PATH.endswith('.jar'):
            run_command(JAVA_PATH, ['-jar', APKTOOL_PATH, 'b', task.decodedDir, '-o', str(unsigned_apk_path)])
        else:
            run_command(APKTOOL_PATH, ['b', task.decodedDir, '-o', str(unsigned_apk_path)])

        _try_zipalign(task, unsigned_apk_path, aligned_apk_path)

        _ensure_debug_keystore(task)
        log_task(task, 'Sign apk')
        run_command(
            APKSIGNER_PATH,
            [
                'sign',
                '--ks',
                str(DEBUG_KEYSTORE_PATH),
                '--ks-key-alias',
                DEBUG_ALIAS,
                '--ks-pass',
                f'pass:{DEBUG_PASS}',
                '--key-pass',
                f'pass:{DEBUG_PASS}',
                '--out',
                str(signed_apk_path),
                str(aligned_apk_path),
            ],
        )

        parse_apk_info(task)
        task.status = 'success'
        log_task(task, 'Mod workflow finished')
    except Exception as exc:  # noqa: BLE001
        set_task_error(task, exc, 'Mod workflow failed')
