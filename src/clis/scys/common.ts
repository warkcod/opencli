import { ArgumentError } from '../../errors.js';
import type { ScysPageType } from './types.js';

const SCYS_ORIGIN = 'https://scys.com';

export function normalizeScysUrl(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) {
    throw new ArgumentError('SCYS URL is required');
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('/')) {
    return `${SCYS_ORIGIN}${raw}`;
  }

  if (raw.startsWith('scys.com')) {
    return `https://${raw}`;
  }

  return `${SCYS_ORIGIN}/${raw.replace(/^\/+/, '')}`;
}

export function toScysCourseUrl(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) throw new ArgumentError('Course URL or course id is required');

  if (/^\d+$/.test(raw)) {
    return `${SCYS_ORIGIN}/course/detail/${raw}`;
  }

  return normalizeScysUrl(raw);
}

export function detectScysPageType(input: string): ScysPageType {
  const url = new URL(normalizeScysUrl(input));
  const pathname = url.pathname;

  if (pathname.startsWith('/course/detail/')) return 'course';
  if (pathname.startsWith('/opportunity')) return 'opportunity';
  if (pathname.startsWith('/activity/landing/')) return 'activity';

  if (pathname.startsWith('/personal/')) {
    const tab = (url.searchParams.get('tab') || '').toLowerCase();
    if (tab === 'posts') return 'feed';
  }

  if (pathname === '/' || pathname === '') {
    const filter = (url.searchParams.get('filter') || '').toLowerCase();
    if (filter === 'essence') return 'feed';
  }

  return 'unknown';
}

export function extractScysCourseId(input: string): string {
  const url = new URL(toScysCourseUrl(input));
  const match = url.pathname.match(/\/course\/detail\/(\d+)/);
  return match?.[1] ?? '';
}

export function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function extractInteractions(raw: string): string {
  const text = cleanText(raw);
  if (!text) return '';

  const pieces = text.match(/[0-9]+(?:\.[0-9]+)?(?:万|亿)?/g);
  if (!pieces || pieces.length === 0) return text;
  return pieces.join(' ');
}

export function inferScysReadUrl(input: string): string {
  return normalizeScysUrl(input);
}

export function buildScysHomeEssenceUrl(): string {
  return `${SCYS_ORIGIN}/?filter=essence`;
}

export function buildScysOpportunityUrl(): string {
  return `${SCYS_ORIGIN}/opportunity`;
}
