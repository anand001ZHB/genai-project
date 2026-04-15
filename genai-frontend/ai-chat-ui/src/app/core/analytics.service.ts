import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { resolveApiBaseUrl } from '../shared/api-base-url';

interface AnalyticsEventPayload {
  eventType: string;
  path?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly apiBaseUrl = resolveApiBaseUrl();
  private readonly visitorStorageKey = 'genai.analytics.visitor-id';

  constructor(private readonly http: HttpClient) {}

  getVisitorId(): string {
    if (typeof localStorage === 'undefined') {
      return 'server-render';
    }

    const existingId = localStorage.getItem(this.visitorStorageKey);
    if (existingId) {
      return existingId;
    }

    const visitorId = `visitor_${crypto.randomUUID()}`;
    localStorage.setItem(this.visitorStorageKey, visitorId);
    return visitorId;
  }

  track(payload: AnalyticsEventPayload) {
    const eventPayload = {
      ...payload,
      visitorId: this.getVisitorId(),
      path: payload.path || (typeof location !== 'undefined' ? location.pathname : '/'),
    };

    return this.http
      .post(this.buildUrl('/analytics/events'), eventPayload, {
        headers: {
          'x-visitor-id': this.getVisitorId(),
        },
      })
      .pipe(catchError(() => of(null)));
  }

  private buildUrl(path: string): string {
    return this.apiBaseUrl ? `${this.apiBaseUrl}${path}` : path;
  }
}
