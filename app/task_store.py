from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone

from app.config import WORK_DIR_ROOT
from app.models import Task

_TASKS: dict[str, Task] = {}
_LOCK = threading.RLock()


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z')


def create_task(file_path: str, original_name: str) -> Task:
    task_id = str(uuid.uuid4())
    now = now_iso()
    task = Task(
        id=task_id,
        status='queued',
        filePath=file_path,
        workDir=str(WORK_DIR_ROOT / task_id),
        createdAt=now,
        updatedAt=now,
    )
    with _LOCK:
        _TASKS[task_id] = task
    log_task(task, f'Uploaded file: {original_name}')
    return task


def get_task(task_id: str) -> Task | None:
    with _LOCK:
        return _TASKS.get(task_id)


def list_tasks() -> list[Task]:
    with _LOCK:
        return sorted(_TASKS.values(), key=lambda t: t.createdAt, reverse=True)


def log_task(task: Task, message: str) -> None:
    stamp = now_iso()
    task.logs.append(f'[{stamp}] {message}')
    task.updatedAt = stamp


def set_task_error(task: Task, error: Exception | str, prefix: str) -> None:
    task.status = 'failed'
    raw = str(error)
    cleaned = ''.join(ch for ch in raw if ord(ch) >= 32 or ch in ('\n', '\r', '\t'))
    task.error = f'{prefix}: {cleaned}'
    log_task(task, task.error)
