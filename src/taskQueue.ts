import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } from './config';
import { runDecompileTask, runModTask } from './buildService';
import { getTask, setTaskError } from './taskStore';
import { ModPayload } from './types';

const connection = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

connection.on('error', (err) => {
    console.error('[Redis] Error connecting to Redis:', err.message);
});

export const modQueue = new Queue('apk-mod', { connection: connection as any });

export const modWorker = new Worker(
    'apk-mod',
    async (job: Job) => {
        const { type, taskId, payload } = job.data as { type: 'decompile' | 'mod' | 'plugin-run'; taskId: string; payload?: ModPayload };
        const task = getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        try {
            if (type === 'decompile') {
                await runDecompileTask(task);
            } else if (type === 'mod' && payload) {
                await runModTask(task, payload);
            } else if (type === 'plugin-run' && payload) {
                if (!task.decodedDir) {
                    await runDecompileTask(task);
                }
                if (task.status === 'success') {
                    await runModTask(task, payload);
                }
            }
        } catch (err) {
            setTaskError(
                task,
                err,
                `${type} failed out of band`,
                type === 'decompile' ? 'APK_DECOMPILE_FAILED' : 'APK_MOD_FAILED',
            );
            throw err;
        }
    },
    {
        connection: connection as any,
        concurrency: 1
    }
);

modWorker.on('completed', (job) => {
    console.log(`[BullMQ] Job ${job.id} has completed!`);
});

modWorker.on('failed', (job, err) => {
    console.error(`[BullMQ] Job ${job?.id} has failed with ${err?.message}`);
});
