import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { workDirRoot } from '../config/env.js';
import type { Task } from '../models/task.js';

const tasks = new Map<string, Task>();

export function createTask(filePath: string, originalName: string): Task {
  const id = randomUUID();
  const now = new Date().toISOString();
  const task: Task = {
    id,
    status: 'queued',
    filePath,
    workDir: path.join(workDirRoot, id),
    createdAt: now,
    updatedAt: now,
    logs: []
  };
  tasks.set(id, task);
  logTask(task, `Uploaded file: ${originalName}`);
  return task;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function listTasks(): Task[] {
  return [...tasks.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function logTask(task: Task, message: string): void {
  const time = new Date().toISOString();
  task.logs.push(`[${time}] ${message}`);
  task.updatedAt = time;
}

export function setTaskError(task: Task, error: unknown, prefix: string): void {
  task.status = 'failed';
  const raw = error instanceof Error ? error.message : String(error);
  const msg = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  task.error = `${prefix}: ${msg}`;
  logTask(task, task.error);
}
