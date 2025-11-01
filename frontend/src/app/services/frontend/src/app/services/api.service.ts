import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly apiUrl = environment.backendApiUrl;

  constructor(private http: HttpClient) { }

  uploadAndStartJob(
    subtitleFile: File, 
    options: { tone: string, thinkingMode: boolean },
    glossaryFile?: File
  ): Promise<{ jobId: string }> {
    const formData = new FormData();
    formData.append('subtitleFile', subtitleFile);
    formData.append('options', JSON.stringify(options));
    if (glossaryFile) {
      formData.append('glossaryFile', glossaryFile);
    }
    return firstValueFrom(this.http.post<{ jobId: string }>(`${this.apiUrl}/api/jobs`, formData));
  }
  
  submitCorrection(correctionData: any): Promise<any> {
    return firstValueFrom(this.http.post(`${this.apiUrl}/api/corrections`, correctionData));
  }
}
