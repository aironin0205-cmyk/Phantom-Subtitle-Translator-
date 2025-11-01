import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
    private socket: WebSocket | null = null;
    public messages = new Subject<any>();

    public connect(jobId: string): void {
        if (this.socket) { this.socket.close(); }
        
        const wsUrl = environment.backendApiUrl.replace(/^http/, 'ws');
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            console.log('WebSocket connection established.');
            this.socket?.send(JSON.stringify({ type: 'register', jobId }));
        };

        this.socket.onmessage = (event) => {
            this.messages.next(JSON.parse(event.data));
        };

        this.socket.onclose = () => {
            console.log('WebSocket connection closed.');
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.messages.error(error);
        };
    }

    public close(): void {
        this.socket?.close();
        this.socket = null;
    }
}
