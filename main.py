from __future__ import annotations

import hmac
import logging
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.build_service import run_decompile_task, run_mod_task
from app.config import (
    API_KEY,
    AUTH_ENABLED,
    FRONTEND_PUBLIC_DIR,
    HOST,
    MOD_UPLOAD_DIR,
    PORT,
    UPLOAD_DIR,
    ensure_runtime_dirs,
)
from app.models import ModPayload
from app.task_store import create_task, get_task, list_tasks, log_task
from app.toolchain import get_toolchain_status
from app.unity_config_service import parse_unity_patches_input, read_unity_config
from app.validators import to_safe_file_stem


logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('apk-modder')


def ok(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status, content={'success': True, 'data': data})


def fail(status: int, message: str, code: str | None = None, details: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={'success': False, 'error': {'message': message, 'code': code, 'details': details}},
    )


def extract_token(request: Request) -> str:
    auth = request.headers.get('authorization', '')
    if auth.lower().startswith('bearer '):
        return auth[7:].strip()

    key_header = request.headers.get('x-api-key', '').strip()
    if key_header:
        return key_header

    query_key = request.query_params.get('api_key', '').strip()
    return query_key


def require_auth(request: Request) -> None:
    if not AUTH_ENABLED or not API_KEY:
        return

    incoming = extract_token(request)
    if not incoming or not hmac.compare_digest(incoming, API_KEY):
        raise HTTPException(status_code=401, detail='Unauthorized')


def _run_in_background(fn, *args) -> None:  # noqa: ANN001
    th = threading.Thread(target=fn, args=args, daemon=True)
    th.start()


ensure_runtime_dirs()

app = FastAPI(title='APK Modder API', docs_url='/api-docs', redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])


@app.middleware('http')
async def log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
    logger.info('request method=%s path=%s', request.method, request.url.path)
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    code = 'UNAUTHORIZED' if exc.status_code == 401 else ('NOT_FOUND' if exc.status_code == 404 else 'BAD_REQUEST')
    return fail(exc.status_code, str(exc.detail), code=code)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return fail(400, 'Bad request', code='BAD_REQUEST', details=exc.errors())


@app.exception_handler(Exception)
async def generic_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    return fail(500, str(exc), code='INTERNAL_ERROR')


@app.get('/health')
async def health() -> JSONResponse:
    return ok({'ok': True, 'service': 'backend'})


@app.get('/api/tools')
async def api_tools() -> JSONResponse:
    return ok(get_toolchain_status())


@app.post('/api/upload')
async def api_upload(apk: UploadFile | None = File(default=None)) -> JSONResponse:
    if not apk:
        return fail(400, 'Missing apk file field "apk"', code='BAD_REQUEST')

    suffix = Path(apk.filename or '').suffix or '.apk'
    upload_path = UPLOAD_DIR / f'{uuid.uuid4().hex}{suffix}'
    with upload_path.open('wb') as out:
        shutil.copyfileobj(apk.file, out)

    task = create_task(str(upload_path), apk.filename or upload_path.name)
    _run_in_background(run_decompile_task, task)
    return ok({'id': task.id, 'status': task.status, 'createdAt': task.createdAt})


@app.get('/api/status/{task_id}')
async def api_status(task_id: str) -> JSONResponse:
    task = get_task(task_id)
    if not task:
        return fail(404, 'Task not found', code='NOT_FOUND')

    return ok(
        {
            'id': task.id,
            'status': task.status,
            'createdAt': task.createdAt,
            'updatedAt': task.updatedAt,
            'logs': task.logs,
            'error': task.error,
            'downloadReady': bool(task.signedApkPath and task.status == 'success'),
            'apkInfo': task.apkInfo.__dict__ if task.apkInfo else None,
        }
    )


@app.get('/api/tasks')
async def api_tasks() -> JSONResponse:
    items = []
    for task in list_tasks():
        items.append(
            {
                'id': task.id,
                'status': task.status,
                'createdAt': task.createdAt,
                'updatedAt': task.updatedAt,
                'error': task.error,
                'downloadReady': bool(task.signedApkPath and task.status == 'success'),
                'apkInfo': task.apkInfo.__dict__ if task.apkInfo else None,
            }
        )
    return ok({'items': items})


@app.get('/api/icon/{task_id}')
async def api_icon(task_id: str) -> FileResponse:
    task = get_task(task_id)
    if not task or not task.iconFilePath or not Path(task.iconFilePath).exists():
        raise HTTPException(status_code=404, detail='Icon not found')
    return FileResponse(task.iconFilePath)


@app.get('/api/unity-config/{task_id}')
async def api_unity_config(task_id: str, path: str | None = None) -> JSONResponse:
    task = get_task(task_id)
    if not task:
        return fail(404, 'Task not found', code='NOT_FOUND')
    try:
        return ok(read_unity_config(task, path))
    except Exception as exc:  # noqa: BLE001
        return fail(400, str(exc), code='BAD_REQUEST')


@app.post('/api/mod')
async def api_mod(
    request: Request,
    id: str = Form(default=''),
    appName: str = Form(default=''),
    packageName: str = Form(default=''),
    versionName: str = Form(default=''),
    versionCode: str = Form(default=''),
    unityConfigPath: str = Form(default=''),
    unityPatches: str = Form(default=''),
    icon: UploadFile | None = File(default=None),
    _auth: None = Depends(require_auth),
) -> JSONResponse:
    del request
    task_id = id.strip()
    if not task_id:
        return fail(400, 'Missing task id', code='BAD_REQUEST')

    task = get_task(task_id)
    if not task:
        return fail(404, 'Task not found', code='NOT_FOUND')
    if task.status == 'processing':
        return fail(409, 'Task is still processing', code='CONFLICT')
    if not task.decodedDir or not Path(task.decodedDir).exists():
        return fail(400, 'Task is not ready for mod, decompile first', code='BAD_REQUEST')

    parsed_unity_patches = []
    try:
        parsed_unity_patches = parse_unity_patches_input(unityPatches)
    except Exception as exc:  # noqa: BLE001
        return fail(400, str(exc), code='BAD_REQUEST')

    icon_upload_path: str | None = None
    if icon:
        icon_ext = Path(icon.filename or '').suffix.lower()
        if icon_ext not in {'.png', '.webp', '.jpg', '.jpeg'}:
            return fail(400, 'Icon format must be one of: .png, .webp, .jpg, .jpeg', code='BAD_REQUEST')
        temp_path = MOD_UPLOAD_DIR / f'{uuid.uuid4().hex}{icon_ext or ".png"}'
        with temp_path.open('wb') as out:
            shutil.copyfileobj(icon.file, out)
        icon_upload_path = str(temp_path)

    app_name = appName.strip() or None
    package_name = packageName.strip() or None
    version_name = versionName.strip() or None
    version_code = versionCode.strip() or None
    unity_config_path = unityConfigPath.strip() or None

    if not any([app_name, package_name, version_name, version_code, icon_upload_path, parsed_unity_patches]):
        return fail(
            400,
            'At least one field is required: appName, packageName, versionName, versionCode, icon, unityPatches',
            code='BAD_REQUEST',
        )

    task.logs.append('')
    log_task(task, 'Queue mod workflow')
    payload = ModPayload(
        appName=app_name,
        packageName=package_name,
        versionName=version_name,
        versionCode=version_code,
        iconUploadPath=icon_upload_path,
        unityConfigPath=unity_config_path,
        unityPatches=parsed_unity_patches,
    )
    _run_in_background(run_mod_task, task, payload)
    return ok({'id': task.id, 'status': task.status})


@app.get('/api/download/{task_id}')
async def api_download(task_id: str, _auth: None = Depends(require_auth)) -> FileResponse:
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail='Task not found')

    if not task.signedApkPath or not Path(task.signedApkPath).exists() or task.status != 'success':
        raise HTTPException(status_code=404, detail='Signed apk is not ready')

    app_name = (task.apkInfo.appName if task.apkInfo else '').strip()
    stem = to_safe_file_stem(app_name) if app_name else f'modded-{task.id}'
    download_name = f'{stem}.apk'
    return FileResponse(task.signedApkPath, media_type='application/vnd.android.package-archive', filename=download_name)


@app.get('/{full_path:path}')
async def static_spa(full_path: str) -> FileResponse | JSONResponse:
    if full_path.startswith('api'):
        return fail(404, f'Route not found: GET /{full_path}', code='NOT_FOUND')

    base = FRONTEND_PUBLIC_DIR
    if not base.exists():
        return fail(404, 'Route not found', code='NOT_FOUND')

    if not full_path or full_path == '/':
        return FileResponse(base / 'index.html')

    target = (base / full_path).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        return fail(404, 'Route not found', code='NOT_FOUND')

    if target.exists() and target.is_file():
        return FileResponse(target)

    return FileResponse(base / 'index.html')


if __name__ == '__main__':
    uvicorn.run('main:app', host=HOST, port=PORT, reload=False)
