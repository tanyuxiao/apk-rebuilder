import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TASK_INDEX_PATH, WORK_DIR_ROOT } from './config';
import { Task } from './types';

function readTasks(): Task[] {
  try {
    const raw = JSON.parse(fs.readFileSync(TASK_INDEX_PATH, 'utf8'));
    return Array.isArray(raw) ? (raw as Task[]) : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: Task[]): void {
  fs.writeFileSync(TASK_INDEX_PATH, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
}

export function nowIso(): string {
  return new Date().toISOString();
}

function saveTask(nextTask: Task): Task {
  const tasks = readTasks();
  const index = tasks.findIndex(task => task.id === nextTask.id);
  if (index >= 0) {
    tasks[index] = nextTask;
  } else {
    tasks.push(nextTask);
  }
  writeTasks(tasks);
  return nextTask;
}

export function createTask(filePath: string, originalName: string, libraryItemId?: string | null): Task {
  const now = nowIso();
  const task: Task = {
    id: randomUUID(),
    status: 'queued',
    filePath,
    sourceName: originalName,
    workDir: path.join(WORK_DIR_ROOT, randomUUID()),
    createdAt: now,
    updatedAt: now,
    logs: [],
    libraryItemId: libraryItemId || null,
  };
  logTask(task, `Uploaded file: ${originalName}`);
  return saveTask(task);
}

export function getTask(taskId: string): Task | undefined {
  return readTasks().find(task => task.id === taskId);
}

export function listTasks(): Task[] {
  return readTasks().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function updateTask(task: Task): Task {
  task.updatedAt = nowIso();
  return saveTask(task);
}

export function logTask(task: Task, message: string): Task {
  task.logs.push(`[${nowIso()}] ${message}`);
  return updateTask(task);
}

export function setTaskError(task: Task, error: unknown, prefix: string): Task {
  task.status = 'failed';
  task.error = `${prefix}: ${String(error).replace(/[^\x09\x0A\x0D\x20-\uFFFF]/g, '')}`;
  return logTask(task, task.error);
}
