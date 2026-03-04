from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.models import ModPayload, Task, UnityPatch
from app.task_store import log_task


def _normalize_unity_config_path(value: str | None) -> str:
    raw = (value or 'Assets/StreamingAssets/scene-config.json').replace('\\', '/').strip()
    if not raw or raw.startswith('/') or '..' in raw:
        raise RuntimeError('Invalid unityConfigPath')
    return raw


def _build_unity_config_candidates(value: str | None) -> list[str]:
    raw = _normalize_unity_config_path(value)
    candidates: list[str] = []

    def _push(path: str) -> None:
        if path and path not in candidates:
            candidates.append(path)

    _push(raw)

    if raw.startswith('Assets/StreamingAssets/'):
        tail = raw[len('Assets/StreamingAssets/') :]
        _push(f'assets/bin/Data/StreamingAssets/{tail}')
        _push(f'assets/StreamingAssets/{tail}')
        _push(f'assets/{tail}')
        return candidates

    if raw == 'Assets/StreamingAssets':
        _push('assets/bin/Data/StreamingAssets')
        _push('assets/StreamingAssets')
        _push('assets')
        return candidates

    if raw.startswith('StreamingAssets/'):
        tail = raw[len('StreamingAssets/') :]
        _push(f'assets/bin/Data/StreamingAssets/{tail}')
        _push(f'assets/StreamingAssets/{tail}')
        _push(f'assets/{tail}')
        return candidates

    if raw.startswith('assets/'):
        _push(f'assets/bin/Data/StreamingAssets/{raw[len("assets/") :]}')

    return candidates


def resolve_unity_config_path(decoded_dir: str, value: str | None = None) -> str:
    root = Path(decoded_dir)
    candidates = _build_unity_config_candidates(value)
    for rel in candidates:
        if (root / rel).exists():
            return rel
    raise RuntimeError(f'Unity config not found. Tried: {", ".join(candidates)}')


def _set_by_path(target: dict[str, Any], dot_path: str, value: Any) -> None:
    keys = [x.strip() for x in dot_path.split('.') if x.strip()]
    if not keys:
        raise RuntimeError(f'Invalid unity patch path: {dot_path}')

    node: Any = target
    for key in keys[:-1]:
        if not isinstance(node, dict):
            raise RuntimeError(f'Invalid unity patch path: {dot_path}')
        child = node.get(key)
        if not isinstance(child, dict):
            child = {}
            node[key] = child
        node = child

    if not isinstance(node, dict):
        raise RuntimeError(f'Invalid unity patch path: {dot_path}')
    node[keys[-1]] = value


def parse_unity_patches_input(raw: Any) -> list[UnityPatch]:
    if not raw:
        return []

    parsed = raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError('unityPatches must be valid JSON') from exc

    if not isinstance(parsed, list):
        raise RuntimeError('unityPatches must be an array')

    result: list[UnityPatch] = []
    for idx, item in enumerate(parsed):
        if not isinstance(item, dict):
            raise RuntimeError(f'unityPatches[{idx}] must be an object')
        path = str(item.get('path', '')).strip()
        if not path:
            raise RuntimeError(f'unityPatches[{idx}].path is required')
        result.append(UnityPatch(path=path, value=item.get('value')))
    return result


def apply_unity_patches(task: Task, payload: ModPayload) -> None:
    patches = payload.unityPatches or []
    if not patches:
        return
    if not task.decodedDir:
        raise RuntimeError('Decoded directory is missing')

    rel_path = resolve_unity_config_path(task.decodedDir, payload.unityConfigPath)
    full_path = Path(task.decodedDir) / rel_path

    try:
        data = json.loads(full_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'Unity config is not valid JSON: {rel_path}') from exc

    if not isinstance(data, dict):
        raise RuntimeError(f'Unity config root must be object: {rel_path}')

    for patch in patches:
        _set_by_path(data, patch.path, patch.value)
        log_task(task, f'Unity param updated: {patch.path}={json.dumps(patch.value, ensure_ascii=False)}')

    full_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def read_unity_config(task: Task, req_path: str | None = None) -> dict[str, Any]:
    if not task.decodedDir or not Path(task.decodedDir).exists():
        raise RuntimeError('Task is not ready, decompile first')

    rel_path = resolve_unity_config_path(task.decodedDir, req_path)
    full_path = Path(task.decodedDir) / rel_path

    try:
        content = json.loads(full_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'Unity config is not valid JSON: {rel_path}') from exc

    return {'path': rel_path, 'content': content}
