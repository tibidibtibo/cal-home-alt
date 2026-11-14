import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef } from '@angular/core';
import { UiCardComponent, UiButtonComponent, UiBadgeComponent } from '../ui';
import { FormsModule } from '@angular/forms';

interface LogEntry {
  ts: string;
  level: string;
  logger?: string;
  msg: string;
  extra?: Record<string, unknown>;
}

interface LogPage {
  items: LogEntry[];
  total: number;
  page: number;
  page_size: number;
}

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [CommonModule, UiCardComponent, UiButtonComponent, UiBadgeComponent, FormsModule],
  templateUrl: './logs.component.html',
  styles: [`
    .logs-table-wrap { overflow-x: auto; margin-top: 1rem; }
    .logs-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .logs-table th, .logs-table td { padding: 0.6rem; text-align: left; border-bottom: 1px solid var(--color-border); vertical-align: top; }
    .logs-table th { color: var(--color-text-muted); font-weight: 600; text-transform: uppercase; font-size: 0.75rem; }
    .level-badge { font-weight: 700; }
    .timestamp { color: var(--color-text-muted); white-space: nowrap; }
    .logger { color: var(--color-text-muted); white-space: nowrap; }
    .msg { word-break: break-word; }
    .filters { display: flex; gap: 1rem; margin-bottom: 1rem; align-items: center; flex-wrap: wrap; }
    .filter-group { display: flex; align-items: center; gap: 0.5rem; white-space: nowrap; }
    .filter-group select { padding: 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); }
    .pager { display: flex; align-items: center; justify-content: flex-end; gap: 1rem; margin-top: 1rem; }
    .pager-info { color: var(--color-text-muted); font-size: 0.85rem; }
  `]
})
export class LogsComponent implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  logs: LogEntry[] = [];
  levelFilter = 'ALL';
  pageSize = 50;
  page = 1;
  total = 0;
  loading = false;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  ngOnInit(): void {
    this.loadLogs();
  }

  loadLogs(): void {
    this.loading = true;
    const params = `page=${this.page}&page_size=${this.pageSize}&level=${this.levelFilter}`;
    this.http.get<LogPage>(`/api/logs?${params}`).subscribe({
      next: (data) => {
        this.logs = data.items;
        this.total = data.total;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  applyFilter(): void {
    this.page = 1;
    this.loadLogs();
  }

  goTo(page: number): void {
    this.page = Math.min(Math.max(1, page), this.totalPages);
    this.loadLogs();
  }

  formatTs(ts: string): string {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleString('fr-FR');
  }

  getBadgeType(level: string): any {
    switch (level) {
      case 'ERROR': return 'error';
      case 'WARNING': return 'warning';
      case 'INFO': return 'info';
      default: return 'neutral';
    }
  }
}
