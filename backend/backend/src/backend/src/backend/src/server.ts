import express from 'express';
import cors from 'cors';
import multer from 'multer';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTranslationJob, jobEvents } from './jobs';
import { connectDB, CorrectionModel } from './db';
import 'dotenv/config';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const port = process.env.PORT || 3001;
connectDB();

const clients = new Map<string, WebSocket>();

wss.on('connection', (ws) => {
    console.log('Client connected via WebSocket');
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'register' && data.jobId) {
                clients.set(data.jobId, ws);
                console.log(`Client registered for job ${data.jobId}`);
                
                const listener = (event: any) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(event));
                    }
                };
                
                jobEvents.on(data.jobId, listener);

                ws.on('close', () => {
                    console.log(`Client for job ${data.jobId} disconnected.`);
                    jobEvents.removeListener(data.jobId, listener);
                    clients.delete(data.jobId);
                });
            }
        } catch (e) { console.error('Failed to parse WebSocket message:', message.toString()); }
    });
});

app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/jobs', upload.fields([{ name: 'subtitleFile', maxCount: 1 }, { name: 'glossaryFile', maxCount: 1 }]), async (req, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files.subtitleFile) return res.status(400).json({ error: 'Subtitle file is required.' });

    try {
        const srtContent = files.subtitleFile[0].buffer.toString('utf-8');
        const options = JSON.parse(req.body.options);
        let userGlossary = [];
        if (files.glossaryFile) {
            userGlossary = JSON.parse(files.glossaryFile[0].buffer.toString('utf-8'));
        }
        
        const job = await createTranslationJob({ subtitleContent: srtContent, userGlossary, ...options });
        res.status(202).json({ jobId: job.id });
    } catch (error) { res.status(500).json({ error: 'Failed to create job.' }); }
});

app.post('/api/corrections', async (req, res) => {
    try {
        const correction = new CorrectionModel(req.body);
        await correction.save();
        res.status(201).json({ message: 'Correction saved successfully.' });
    } catch (error) { res.status(500).json({ error: 'Failed to save correction.' }); }
});

server.listen(port, () => {
    console.log(`Enterprise server with WebSocket listening on port ${port}`);
});
