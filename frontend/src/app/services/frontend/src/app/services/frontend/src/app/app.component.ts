import { Component, ChangeDetectionStrategy, signal, computed, inject, OnDestroy } from '@angular/core';
import { ApiService } from './services/api.service';
import { WebSocketService } from './services/websocket.service';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { Subscription } from 'rxjs';

type AppState = 'idle' | 'uploading' | 'processing' | 'reviewing' | 'completed' | 'failed';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnDestroy {
  private api = inject(ApiService);
  private ws = inject(WebSocketService);
  private wsSubscription: Subscription | null = null;
  private currentJobId = '';

  appState = signal<AppState>('idle');
  jobProgress = signal<string>('Waiting to start...');
  error = signal<string | null>(null);
  
  originalSrt = signal<string>('');
  aiTranslation = signal<string>('');
  userCorrection = signal<string>('');
  
  selectedFile = signal<File | null>(null);
  selectedFileName = signal<string>('');
  selectedGlossaryFile = signal<File | null>(null);
  selectedGlossaryFileName = signal<string>('');
  
  selectedTone = signal<string>('Professional');
  thinkingMode = signal<boolean>(false);
  
  isProcessing = computed(() => this.appState() === 'uploading' || this.appState() === 'processing');
  readonly tones = ['Professional', 'Literary', 'Casual', 'Technical', 'Cinematic', 'Slang'];

  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.ws.close();
  }

  onFileSelected(event: Event, type: 'subtitle' | 'glossary'): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (type === 'subtitle') {
      this.selectedFile.set(file);
      this.selectedFileName.set(file.name);
    } else {
      this.selectedGlossaryFile.set(file);
      this.selectedGlossaryFileName.set(file.name);
    }
  }
  
  async onTranslate(): Promise<void> {
    if (!this.selectedFile()) { this.error.set("Subtitle file is required."); return; }
    
    this.resetStateForNewJob();
    this.appState.set('uploading');
    this.originalSrt.set(await this.selectedFile()!.text());

    try {
      const options = { tone: this.selectedTone(), thinkingMode: this.thinkingMode() };
      const { jobId } = await this.api.uploadAndStartJob(this.selectedFile()!, options, this.selectedGlossaryFile() || undefined);
      this.currentJobId = jobId;
      
      this.appState.set('processing');
      this.ws.connect(jobId);
      this.wsSubscription = this.ws.messages.subscribe({
        next: (msg) => this.handleWsMessage(msg),
        error: (err) => this.handleWsMessage({ type: 'failed', payload: { error: 'Connection to server lost.' }})
      });
    } catch (err: any) {
      this.error.set(err.message || 'Failed to start job.');
      this.appState.set('failed');
    }
  }

  handleWsMessage(msg: any): void {
    switch (msg.type) {
      case 'progress':
        this.jobProgress.set(msg.payload.stage);
        break;
      case 'completed':
        this.aiTranslation.set(msg.payload.result);
        this.userCorrection.set(msg.payload.result);
        this.appState.set('reviewing');
        this.ws.close();
        break;
      case 'failed':
        this.error.set(msg.payload.error);
        this.appState.set('failed');
        this.ws.close();
        break;
    }
  }

  onCorrectionChange(event: Event) {
    this.userCorrection.set((event.target as HTMLTextAreaElement).value);
  }

  async submitAndFinish() {
    if (this.aiTranslation() !== this.userCorrection()) {
      try {
        await this.api.submitCorrection({
          originalEnglish: 'Full SRT content for now', // In a real app, you'd send line-by-line diffs
          aiTranslation: this.aiTranslation(),
          userCorrection: this.userCorrection(),
          jobId: this.currentJobId
        });
      } catch (e) { console.error("Failed to submit correction"); }
    }
    this.appState.set('completed');
  }

  startNew() {
    this.resetStateForNewJob();
    this.selectedFile.set(null);
    this.selectedFileName.set('');
    this.selectedGlossaryFile.set(null);
    this.selectedGlossaryFileName.set('');
  }

  resetStateForNewJob(): void {
    this.appState.set('idle');
    this.error.set(null);
    this.jobProgress.set('Waiting to start...');
    this.originalSrt.set('');
    this.aiTranslation.set('');
    this.userCorrection.set('');
    this.wsSubscription?.unsubscribe();
    this.ws.close();
  }
}
