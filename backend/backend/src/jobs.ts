import { Job, Queue, Worker } from 'bullmq';
import { TranslationWorkerService } from './translation.worker';
import { UserGlossaryItem } from './types';
import { EventEmitter } from 'events';

export const jobEvents = new EventEmitter();

const redisConnection = { host: process.env.REDIS_HOST || '127.0.0.1', port: parseInt(process.env.REDIS_PORT || '6379', 10) };
export const translationQueue = new Queue('translation-jobs', { connection: redisConnection });

interface TranslationJobData {
    jobId: string;
    subtitleContent: string;
    tone: string;
    thinkingMode: boolean;
    userGlossary: UserGlossaryItem[];
}

export async function createTranslationJob(data: Omit<TranslationJobData, 'jobId'>) {
    const job = await translationQueue.add('translate-subtitle', data as TranslationJobData, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 }
    });
    await job.updateData({ ...job.data, jobId: job.id });
    return job;
}

export function startWorker() {
    console.log("Enterprise worker process started...");
    new Worker('translation-jobs', async (job: Job<TranslationJobData>) => {
        const { jobId, subtitleContent, tone, thinkingMode, userGlossary } = job.data;
        const service = new TranslationWorkerService();

        const updateStage = (stage: string) => {
            job.updateProgress({ stage });
            jobEvents.emit(jobId, { type: 'progress', payload: { stage } });
        };
        
        try {
            updateStage('Generating blueprint...');
            const blueprint = await service.generateBlueprint(subtitleContent, tone, userGlossary, updateStage);
            const translationBrief = service.stringifyBlueprint(blueprint);
            jobEvents.emit(jobId, { type: 'blueprint_ready', payload: blueprint });
            
            updateStage('Executing translation...');
            const finalTranslation = await service.executeTranslation(jobId, subtitleContent, tone, translationBrief, updateStage);

            jobEvents.emit(jobId, { type: 'completed', payload: { result: finalTranslation } });
            return { result: finalTranslation };
        } catch (error: any) {
            jobEvents.emit(jobId, { type: 'failed', payload: { error: error.message } });
            throw error;
        }
    }, { connection: redisConnection, concurrency: 1 });
}
