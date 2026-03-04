from __future__ import annotations

import re
from pathlib import Path

from app.models import ApkInfo, ModPayload, Task
from app.task_store import log_task
from app.validators import is_valid_package_name, is_valid_version_code


def _escape_xml_attr(value: str) -> str:
    return (
        value.replace('&', '&amp;')
        .replace('"', '&quot;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
    )


def _read_attr(tag: str, attr: str) -> str:
    escaped = re.escape(attr)
    m = re.search(rf'{escaped}="([^"]*)"', tag)
    return m.group(1) if m else ''


def _decode_resource_string(value: str) -> str:
    return (
        value.replace('&quot;', '"')
        .replace('&apos;', "'")
        .replace('&lt;', '<')
        .replace('&gt;', '>')
        .replace('&amp;', '&')
    )


def _read_version_from_apktool_yml(decoded_dir: Path) -> tuple[str, str]:
    yml_path = decoded_dir / 'apktool.yml'
    if not yml_path.exists():
        return '', ''
    text = yml_path.read_text(encoding='utf-8')

    def _extract(name: str) -> str:
        m1 = re.search(rf'^\s*{name}:\s*[\'\"]?([^\r\n\'\"]+)[\'\"]?\s*$', text, flags=re.MULTILINE)
        if m1:
            return m1.group(1).strip()
        m2 = re.search(rf'^\s*{name}:\s*([^\r\n]+)\s*$', text, flags=re.MULTILINE)
        return m2.group(1).replace("'", '').replace('"', '').strip() if m2 else ''

    return _extract('versionName'), _extract('versionCode')


def _resolve_string_label(decoded_dir: Path, label_ref: str) -> str:
    if not label_ref.startswith('@string/'):
        return label_ref

    name = label_ref.replace('@string/', '').strip()
    if not name:
        return label_ref

    res_dir = decoded_dir / 'res'
    dirs = ['values'] + [x.name for x in res_dir.iterdir()] if res_dir.exists() else ['values']
    values_dirs = []
    for item in dirs:
        if item.startswith('values') and item not in values_dirs:
            values_dirs.append(item)

    escaped_name = re.escape(name)
    for values_dir in values_dirs:
        strings_path = decoded_dir / 'res' / values_dir / 'strings.xml'
        if not strings_path.exists():
            continue
        content = strings_path.read_text(encoding='utf-8')
        m = re.search(rf'<string\s+name="{escaped_name}"[^>]*>([\s\S]*?)</string>', content)
        if m and m.group(1):
            return _decode_resource_string(m.group(1).strip())

    return label_ref


def _resolve_icon_file(decoded_dir: Path, icon_ref: str) -> str | None:
    if not icon_ref.startswith('@'):
        return None

    clean = icon_ref[1:]
    if '/' not in clean:
        return None
    res_type, res_name = clean.split('/', 1)
    if not res_type or not res_name:
        return None

    res_root = decoded_dir / 'res'
    if not res_root.exists():
        return None

    density_rank = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'anydpi']
    candidates: list[Path] = []
    for folder in res_root.iterdir():
        if not folder.is_dir():
            continue
        if folder.name != res_type and not folder.name.startswith(f'{res_type}-'):
            continue
        for child in folder.iterdir():
            if child.stem == res_name and child.suffix.lower() in {'.png', '.webp', '.jpg', '.jpeg'}:
                candidates.append(child)

    if not candidates:
        return None

    def _score(p: Path) -> int:
        directory = p.parent.name
        for idx, key in enumerate(density_rank):
            if key in directory:
                return idx
        return len(density_rank)

    candidates.sort(key=_score)
    return str(candidates[0])


def parse_apk_info(task: Task) -> None:
    if not task.decodedDir:
        return
    decoded_dir = Path(task.decodedDir)
    manifest_path = decoded_dir / 'AndroidManifest.xml'
    if not manifest_path.exists():
        return

    xml = manifest_path.read_text(encoding='utf-8')
    manifest_tag = re.search(r'<manifest\b[^>]*>', xml)
    app_tag = re.search(r'<application\b[^>]*>', xml)

    manifest_text = manifest_tag.group(0) if manifest_tag else ''
    app_text = app_tag.group(0) if app_tag else ''

    package_name = _read_attr(manifest_text, 'package')
    version_name = _read_attr(manifest_text, 'android:versionName')
    version_code = _read_attr(manifest_text, 'android:versionCode')
    app_label_raw = _read_attr(app_text, 'android:label')
    icon_ref = _read_attr(app_text, 'android:icon')

    app_name = _resolve_string_label(decoded_dir, app_label_raw or package_name or '')
    icon_file_path = _resolve_icon_file(decoded_dir, icon_ref)
    if not version_name or not version_code:
        vn, vc = _read_version_from_apktool_yml(decoded_dir)
        version_name = version_name or vn
        version_code = version_code or vc

    task.iconFilePath = icon_file_path
    task.apkInfo = ApkInfo(
        appName=app_name,
        packageName=package_name,
        versionName=version_name,
        versionCode=version_code,
        appLabelRaw=app_label_raw,
        iconRef=icon_ref,
        iconUrl=f'/api/icon/{task.id}?v=1' if icon_file_path else None,
    )


def apply_icon_replacement(task: Task, icon_upload_path: str, ext: str) -> str:
    if not task.decodedDir:
        raise RuntimeError('Decoded directory is missing')

    res_root = Path(task.decodedDir) / 'res'
    res_root.mkdir(parents=True, exist_ok=True)

    target_name = 'ic_launcher_modder'
    mipmap_dirs = [d.name for d in res_root.iterdir() if d.is_dir() and d.name.startswith('mipmap')] if res_root.exists() else []
    if not mipmap_dirs:
        mipmap_dirs = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi']

    source = Path(icon_upload_path)
    for folder in mipmap_dirs:
        folder_path = res_root / folder
        folder_path.mkdir(parents=True, exist_ok=True)
        (folder_path / f'{target_name}{ext}').write_bytes(source.read_bytes())

    log_task(task, f'Icon files updated in {len(mipmap_dirs)} mipmap folders')
    return f'@mipmap/{target_name}'


def update_manifest(task: Task, payload: ModPayload, icon_ref: str | None = None) -> None:
    if not task.decodedDir:
        raise RuntimeError('Decoded directory is missing')

    manifest_path = Path(task.decodedDir) / 'AndroidManifest.xml'
    if not manifest_path.exists():
        raise RuntimeError('AndroidManifest.xml not found after decompile')

    xml = manifest_path.read_text(encoding='utf-8')
    current_manifest_tag = re.search(r'<manifest\b[^>]*>', xml)
    current_package_name = _read_attr(current_manifest_tag.group(0) if current_manifest_tag else '', 'package')

    if payload.packageName:
        package_name = payload.packageName.strip()
        if not is_valid_package_name(package_name):
            raise RuntimeError('Invalid package name format')

        if re.search(r'\bpackage="[^"]*"', xml):
            xml = re.sub(r'\bpackage="[^"]*"', f'package="{_escape_xml_attr(package_name)}"', xml, count=1)
        elif re.search(r'<manifest\b[^>]*>', xml):
            xml = re.sub(
                r'<manifest\b([^>]*)>',
                f'<manifest\\1 package="{_escape_xml_attr(package_name)}">',
                xml,
                count=1,
            )
        log_task(task, f'Manifest updated: packageName={package_name}')

        if current_package_name and current_package_name != package_name:
            old_prefix = re.escape(f'{current_package_name}.')
            xml = re.sub(old_prefix, f'{package_name}.', xml)
            xml = re.sub(
                rf'([="\']){re.escape(current_package_name)}(["\'])',
                rf'\1{package_name}\2',
                xml,
            )
            log_task(task, f'Manifest updated: renamed package-scoped refs {current_package_name} -> {package_name}')

    if payload.versionName:
        version_name = _escape_xml_attr(payload.versionName.strip())
        if re.search(r'android:versionName="[^"]*"', xml):
            xml = re.sub(r'android:versionName="[^"]*"', f'android:versionName="{version_name}"', xml, count=1)
        elif re.search(r'<manifest\b[^>]*>', xml):
            xml = re.sub(r'<manifest\b([^>]*)>', f'<manifest\\1 android:versionName="{version_name}">', xml, count=1)
        log_task(task, f'Manifest updated: versionName={payload.versionName}')

    if payload.versionCode:
        version_code = payload.versionCode.strip()
        if not is_valid_version_code(version_code):
            raise RuntimeError('versionCode must be a non-negative integer')
        if re.search(r'android:versionCode="[^"]*"', xml):
            xml = re.sub(r'android:versionCode="[^"]*"', f'android:versionCode="{version_code}"', xml, count=1)
        elif re.search(r'<manifest\b[^>]*>', xml):
            xml = re.sub(r'<manifest\b([^>]*)>', f'<manifest\\1 android:versionCode="{version_code}">', xml, count=1)
        log_task(task, f'Manifest updated: versionCode={payload.versionCode}')

    if payload.appName:
        app_name = _escape_xml_attr(payload.appName.strip())
        if re.search(r'android:label="[^"]*"', xml):
            xml = re.sub(r'android:label="[^"]*"', f'android:label="{app_name}"', xml, count=1)
        elif re.search(r'<application\b[^>]*>', xml):
            xml = re.sub(r'<application\b([^>]*)>', f'<application\\1 android:label="{app_name}">', xml, count=1)
        else:
            raise RuntimeError('No <application> tag found in AndroidManifest.xml')
        log_task(task, f'Manifest updated: appName={payload.appName}')

    if icon_ref:
        safe_icon = _escape_xml_attr(icon_ref)
        if re.search(r'android:icon="[^"]*"', xml):
            xml = re.sub(r'android:icon="[^"]*"', f'android:icon="{safe_icon}"', xml, count=1)
        elif re.search(r'<application\b[^>]*>', xml):
            xml = re.sub(r'<application\b([^>]*)>', f'<application\\1 android:icon="{safe_icon}">', xml, count=1)

        if re.search(r'android:roundIcon="[^"]*"', xml):
            xml = re.sub(r'android:roundIcon="[^"]*"', f'android:roundIcon="{safe_icon}"', xml, count=1)
        log_task(task, f'Manifest updated: iconRef={icon_ref}')

    manifest_path.write_text(xml, encoding='utf-8')
