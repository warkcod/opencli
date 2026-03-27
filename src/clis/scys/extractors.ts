import { AuthRequiredError, EmptyResultError } from '../../errors.js';
import type { IPage } from '../../types.js';
import {
  cleanText,
  extractInteractions,
  extractScysCourseId,
  normalizeScysUrl,
  toScysCourseUrl,
} from './common.js';
import type {
  ScysActivitySummary,
  ScysCourseSummary,
  ScysFeedRow,
  ScysOpportunityRow,
  ScysTocRow,
} from './types.js';

interface ExtractOptions {
  waitSeconds?: number;
  limit?: number;
  maxLength?: number;
}

const SCYS_DOMAIN = 'scys.com';

async function gotoAndWait(page: IPage, url: string, waitSeconds: number): Promise<void> {
  await page.goto(url);
  await page.wait(waitSeconds);
}

export async function ensureScysLogin(page: IPage): Promise<void> {
  const state = await page.evaluate(`
    (() => {
      const text = (document.body?.innerText || '').slice(0, 12000);
      const loginByText = /扫码登录|手机号登录|验证码登录|登录后|请登录/.test(text);
      const loginByDom = !!document.querySelector(
        '.login-container, .login-box, .qrcode-login, [class*="login"], input[type="password"]'
      );
      const routeLooksLikeLogin = /\/login/.test(location.pathname);
      return { loginByText, loginByDom, routeLooksLikeLogin };
    })()
  `) as { loginByText?: boolean; loginByDom?: boolean; routeLooksLikeLogin?: boolean } | null;

  if (!state) return;
  if (state.loginByText || state.routeLooksLikeLogin) {
    throw new AuthRequiredError(SCYS_DOMAIN, 'SCYS content requires a logged-in browser session');
  }
}

export async function extractScysCourse(page: IPage, inputUrl: string, opts: ExtractOptions = {}): Promise<ScysCourseSummary> {
  const url = toScysCourseUrl(inputUrl);
  const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));
  const maxLength = Math.max(300, Number(opts.maxLength ?? 4000));

  await gotoAndWait(page, url, waitSeconds);
  await ensureScysLogin(page);

  const payload = await page.evaluate(`
    (() => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const pickFirstText = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          const text = clean(el?.textContent || el?.innerText || '');
          if (text) return text;
        }
        return '';
      };

      const pickFirstEl = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) return el;
        }
        return null;
      };

      const contentEl = pickFirstEl([
        '.vc-course-main',
        '.course-content-container',
        '.vc-course-content',
        '.document-container',
        '.feishu-doc-content',
        '.content-container',
      ]);

      const chapterItems = Array.from(document.querySelectorAll('.vc-chapter-item[data-item-id], .chapter-list .vc-chapter-item')).map((el) => {
        const item = el;
        const id = clean(item.getAttribute('data-item-id') || '');
        const title = clean(
          item.querySelector('.chapter-title')?.textContent ||
          item.querySelector('.chapter-content')?.textContent ||
          item.textContent ||
          ''
        );
        const status = clean(item.querySelector('.chapter-status')?.textContent || item.querySelector('.chapter-meta')?.textContent || '');
        const cls = item.className || '';
        const isCurrent = /active|current|selected|is-active/.test(cls) || item.getAttribute('aria-current') === 'true';
        return { id, title, status, isCurrent };
      }).filter((row) => row.title);

      const breadcrumbTexts = Array.from(
        document.querySelectorAll('.breadcrumb a, .breadcrumb span, .vc-breadcrumb a, .vc-breadcrumb span')
      )
        .map((el) => clean(el.textContent || ''))
        .filter(Boolean);

      const title = pickFirstText(['h1', '.course-title', '.vc-course-title']) || clean(document.title || '');
      const currentChapter =
        chapterItems.find((item) => item.isCurrent)?.title ||
        pickFirstText(['.vc-chapter-item.is-active .chapter-title', '.vc-chapter-item.active .chapter-title', '.current-chapter', 'h2']);

      const chapterIdFromQuery = new URL(location.href).searchParams.get('chapterId') || '';
      const chapterId = chapterIdFromQuery || chapterItems.find((item) => item.isCurrent)?.id || '';

      return {
        title,
        currentChapter,
        breadcrumb: breadcrumbTexts,
        content: clean(contentEl?.innerText || ''),
        chapters: chapterItems,
        chapterId,
        pageUrl: location.href,
      };
    })()
  `) as {
    title?: string;
    currentChapter?: string;
    breadcrumb?: string[];
    content?: string;
    chapters?: Array<{ id?: string; title?: string; status?: string; isCurrent?: boolean }>;
    chapterId?: string;
    pageUrl?: string;
  } | null;

  if (!payload) {
    throw new EmptyResultError('scys/course', 'Failed to extract course page content');
  }

  const courseId = extractScysCourseId(url);
  const content = cleanText(payload.content ?? '').slice(0, maxLength);
  const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const tocSummary = chapters
    .slice(0, 8)
    .map((item, index) => `${index + 1}.${cleanText(item.title)}${item.id ? `(${item.id})` : ''}`)
    .join(' | ');

  if (!content && chapters.length === 0) {
    throw new EmptyResultError('scys/course', 'No course content or table of contents was detected');
  }

  return {
    course_title: cleanText(payload.title ?? ''),
    chapter_title: cleanText(payload.currentChapter ?? ''),
    breadcrumb: (payload.breadcrumb ?? []).map((s) => cleanText(s)).filter(Boolean).join(' > '),
    content,
    chapter_id: cleanText(payload.chapterId ?? ''),
    course_id: courseId,
    toc_summary: tocSummary,
    url: normalizeScysUrl(payload.pageUrl || url),
  };
}

export async function extractScysToc(page: IPage, courseInput: string, opts: ExtractOptions = {}): Promise<ScysTocRow[]> {
  const url = toScysCourseUrl(courseInput);
  const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 2));

  await gotoAndWait(page, url, waitSeconds);
  await ensureScysLogin(page);

  const rows = await page.evaluate(`
    (() => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const out = [];

      const groups = Array.from(document.querySelectorAll('.vc-chapter-group'));
      if (groups.length > 0) {
        groups.forEach((group) => {
          const groupTitle = clean(
            group.querySelector('.group-title, .chapter-group-title, .vc-group-title')?.textContent ||
            ''
          );
          const items = Array.from(group.querySelectorAll('.vc-chapter-item[data-item-id], .vc-chapter-item'));
          items.forEach((item) => {
            const id = clean(item.getAttribute('data-item-id') || '');
            const title = clean(
              item.querySelector('.chapter-title')?.textContent ||
              item.querySelector('.chapter-content')?.textContent ||
              item.textContent ||
              ''
            );
            const status = clean(item.querySelector('.chapter-status, .chapter-meta')?.textContent || '');
            const cls = item.className || '';
            const isCurrent = /active|current|selected|is-active/.test(cls) || item.getAttribute('aria-current') === 'true';
            if (title) out.push({ group: groupTitle, chapter_id: id, chapter_title: title, status, is_current: isCurrent });
          });
        });
      }

      if (out.length === 0) {
        const items = Array.from(document.querySelectorAll('.chapter-list .vc-chapter-item, .vc-chapter-item[data-item-id]'));
        items.forEach((item) => {
          const id = clean(item.getAttribute('data-item-id') || '');
          const title = clean(
            item.querySelector('.chapter-title')?.textContent ||
            item.querySelector('.chapter-content')?.textContent ||
            item.textContent ||
            ''
          );
          const status = clean(item.querySelector('.chapter-status, .chapter-meta')?.textContent || '');
          const cls = item.className || '';
          const isCurrent = /active|current|selected|is-active/.test(cls) || item.getAttribute('aria-current') === 'true';
          if (title) out.push({ group: '', chapter_id: id, chapter_title: title, status, is_current: isCurrent });
        });
      }

      return out;
    })()
  `) as Array<{ group?: string; chapter_id?: string; chapter_title?: string; status?: string; is_current?: boolean }> | null;

  const normalized = (rows ?? []).map((row, index) => ({
    rank: index + 1,
    group: cleanText(row.group ?? ''),
    chapter_id: cleanText(row.chapter_id ?? ''),
    chapter_title: cleanText(row.chapter_title ?? ''),
    status: cleanText(row.status ?? ''),
    is_current: !!row.is_current,
  }));

  if (normalized.length === 0) {
    throw new EmptyResultError('scys/toc', 'No chapter list was detected on this course page');
  }

  return normalized;
}

export async function extractScysFeed(page: IPage, inputUrl: string, opts: ExtractOptions = {}): Promise<ScysFeedRow[]> {
  const url = normalizeScysUrl(inputUrl);
  const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));
  const limit = Math.max(1, Number(opts.limit ?? 20));

  await gotoAndWait(page, url, waitSeconds);
  await page.autoScroll({ times: 2, delayMs: 1200 });
  await ensureScysLogin(page);

  const rows = await page.evaluate(`
    (() => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const abs = (href) => {
        if (!href) return '';
        if (/^https?:\/\//.test(href)) return href;
        if (href.startsWith('/')) return location.origin + href;
        return '';
      };

      const cards = Array.from(document.querySelectorAll('.post-list-container .compact-card, .compact-card'));
      return cards.map((card) => {
        const author = clean(
          card.querySelector('.user-line .name, .user-line .nickname, .author-name')?.textContent ||
          card.querySelector('.user-line')?.textContent ||
          ''
        );
        const time = clean(card.querySelector('.user-line .time, .meta-line .time, .meta-line')?.textContent || '');
        const badge = clean(card.querySelector('.vc-essence-badge, .badge')?.textContent || '');
        const title = clean(card.querySelector('.title-text, .title-line .title, .title-line')?.textContent || '');
        const preview = clean(card.querySelector('.content-preview, .preview, .content')?.textContent || '');
        const tags = Array.from(card.querySelectorAll('.tags .tag, .tags span, .tag-list .tag'))
          .map((el) => clean(el.textContent || ''))
          .filter(Boolean);
        const interactions = clean(card.querySelector('.compact-interactions, .interactions')?.textContent || '');

        const links = Array.from(card.querySelectorAll('a[href]'))
          .map((el) => abs(el.getAttribute('href') || ''))
          .filter(Boolean);

        const uniqLinks = Array.from(new Set(links));

        return {
          author,
          time,
          badge,
          title,
          preview,
          tags,
          interactions,
          link: uniqLinks[0] || '',
        };
      }).filter((item) => item.title || item.preview);
    })()
  `) as Array<{
    author?: string;
    time?: string;
    badge?: string;
    title?: string;
    preview?: string;
    tags?: string[];
    interactions?: string;
    link?: string;
  }> | null;

  const normalized = (rows ?? []).slice(0, limit).map((row, index) => ({
    rank: index + 1,
    author: cleanText(row.author ?? ''),
    time: cleanText(row.time ?? ''),
    badge: cleanText(row.badge ?? ''),
    title: cleanText(row.title ?? ''),
    preview: cleanText(row.preview ?? ''),
    tags: (row.tags ?? []).map((tag) => cleanText(tag)).filter(Boolean).join(', '),
    interactions: extractInteractions(row.interactions ?? ''),
    link: cleanText(row.link ?? ''),
  }));

  if (normalized.length === 0) {
    throw new EmptyResultError('scys/feed', 'No feed cards were detected on this page');
  }

  return normalized;
}

export async function extractScysOpportunity(page: IPage, inputUrl: string, opts: ExtractOptions = {}): Promise<ScysOpportunityRow[]> {
  const url = normalizeScysUrl(inputUrl);
  const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));
  const limit = Math.max(1, Number(opts.limit ?? 20));

  await gotoAndWait(page, url, waitSeconds);
  await page.autoScroll({ times: 2, delayMs: 1200 });
  await ensureScysLogin(page);

  const rows = await page.evaluate(`
    (() => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const abs = (href) => {
        if (!href) return '';
        if (/^https?:\/\//.test(href)) return href;
        if (href.startsWith('/')) return location.origin + href;
        return '';
      };

      const cards = Array.from(document.querySelectorAll('.post-list-container .post-item, .post-item'));
      return cards.map((card) => {
        const top = card.querySelector('.post-item-top') || card;
        const author = clean(top.querySelector('.author, .name, .nickname, .user-name')?.textContent || top.querySelector('.user-line')?.textContent || '');
        const time = clean(top.querySelector('.time, .meta-time, .meta-line')?.textContent || '');

        const flags = Array.from(card.querySelectorAll('.post-item-top .badge, .post-item-top .flag, .post-title .flag, .post-title .tag'))
          .map((el) => clean(el.textContent || ''))
          .filter(Boolean);

        const title = clean(card.querySelector('.post-title, .title-text, .title-line')?.textContent || '');
        const content = clean(card.querySelector('.content-stream, .post-content, .content-preview')?.textContent || '');
        const aiSummary = clean(card.querySelector('.ai-summary-container, .ai-summary')?.textContent || '');
        const tags = Array.from(card.querySelectorAll('.label-box .label, .label-box span, .tags .tag'))
          .map((el) => clean(el.textContent || ''))
          .filter(Boolean);
        const interactions = clean(card.querySelector('.interactions, .compact-interactions')?.textContent || '');
        const link = abs(card.querySelector('a[href]')?.getAttribute('href') || '');

        return {
          author,
          time,
          flags,
          title,
          content,
          ai_summary: aiSummary,
          tags,
          interactions,
          link,
        };
      }).filter((item) => item.title || item.content);
    })()
  `) as Array<{
    author?: string;
    time?: string;
    flags?: string[];
    title?: string;
    content?: string;
    ai_summary?: string;
    tags?: string[];
    interactions?: string;
    link?: string;
  }> | null;

  const normalized = (rows ?? []).slice(0, limit).map((row, index) => ({
    rank: index + 1,
    author: cleanText(row.author ?? ''),
    time: cleanText(row.time ?? ''),
    flags: (row.flags ?? []).map((f) => cleanText(f)).filter(Boolean).join(', '),
    title: cleanText(row.title ?? ''),
    content: cleanText(row.content ?? ''),
    ai_summary: cleanText(row.ai_summary ?? ''),
    tags: (row.tags ?? []).map((tag) => cleanText(tag)).filter(Boolean).join(', '),
    interactions: extractInteractions(row.interactions ?? ''),
    link: cleanText(row.link ?? ''),
  }));

  if (normalized.length === 0) {
    throw new EmptyResultError('scys/opportunity', 'No opportunity cards were detected on this page');
  }

  return normalized;
}

export async function extractScysActivity(page: IPage, inputUrl: string, opts: ExtractOptions = {}): Promise<ScysActivitySummary> {
  const url = normalizeScysUrl(inputUrl);
  const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));

  await gotoAndWait(page, url, waitSeconds);
  await ensureScysLogin(page);

  const payload = await page.evaluate(`
    (() => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();

      const title = clean(
        document.querySelector('h1, .activity-title, .landing-title')?.textContent ||
        document.title ||
        ''
      );
      const subtitle = clean(
        document.querySelector('.subtitle, .sub-title, .activity-subtitle, .landing-subtitle')?.textContent ||
        ''
      );

      const tabs = Array.from(document.querySelectorAll('.tabs .tab, .tabs [role="tab"], .tab-item'))
        .map((el) => clean(el.textContent || ''))
        .filter(Boolean);

      const stageEls = Array.from(document.querySelectorAll('.week-card, .activity-line-content .stage, .activity-left .stage-card, .activity-left .week-card'));
      const stages = stageEls.map((stage) => {
        const stageTitle = clean(stage.querySelector('h2, h3, .title, .stage-title, .week-title')?.textContent || '');
        const duration = clean(stage.querySelector('.duration, .time, .date-range, .stage-duration')?.textContent || '');
        const tasks = Array.from(stage.querySelectorAll('li, .task-item, .todo-item'))
          .map((el) => clean(el.textContent || ''))
          .filter(Boolean);
        return { title: stageTitle, duration, tasks };
      }).filter((stage) => stage.title || stage.tasks.length > 0);

      return {
        title,
        subtitle,
        tabs,
        stages,
        url: location.href,
      };
    })()
  `) as ScysActivitySummary | null;

  if (!payload) {
    throw new EmptyResultError('scys/activity', 'Failed to extract activity page content');
  }

  if (!payload.title && (!payload.stages || payload.stages.length === 0)) {
    throw new EmptyResultError('scys/activity', 'No activity title or stages were detected');
  }

  return {
    title: cleanText(payload.title),
    subtitle: cleanText(payload.subtitle),
    tabs: (payload.tabs ?? []).map((tab) => cleanText(tab)).filter(Boolean),
    stages: (payload.stages ?? []).map((stage) => ({
      title: cleanText(stage.title),
      duration: cleanText(stage.duration),
      tasks: (stage.tasks ?? []).map((task) => cleanText(task)).filter(Boolean),
    })),
    url: normalizeScysUrl(payload.url || url),
  };
}
