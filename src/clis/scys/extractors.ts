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
import {
  buildScysTopicLink,
  formatScysRelativeTime,
  inferTopicIdFromImageUrls,
  normalizeOpportunityTab,
  parseAiSummaryText,
  stripScysRichText,
  splitOpportunityFlagsAndTags,
} from './opportunity-utils.js';

interface ExtractOptions {
  waitSeconds?: number;
  limit?: number;
  maxLength?: number;
  tab?: string;
}

const SCYS_DOMAIN = 'scys.com';
const SCYS_TEXT_FIXUPS: Array<[RegExp, string]> = [
  [/\bCur\s*or\b/g, 'Cursor'],
  [/\bBu\s*ine\b/g, 'Business'],
  [/\bJava\s*cript\b/g, 'Javascript'],
  [/\bSupaba\s*e\b/g, 'Supabase'],
  [/\bcreen\s*haring\b/gi, 'screensharing'],
  [/\bfa\s*t3d\b/gi, 'fast3d'],
];

async function gotoAndWait(page: IPage, url: string, waitSeconds: number): Promise<void> {
  await page.goto(url);
  await page.wait(waitSeconds);
}

function pickPreferredScysLink(candidates: Array<unknown>): string {
  const links = Array.from(
    new Set(
      candidates
        .map((value) => cleanText(value))
        .filter(Boolean)
        .map((value) => value.replace(/\s+/g, ''))
    )
  );
  if (links.length === 0) return '';

  const detail = links.find((link) => /^https?:\/\/(?:www\.)?scys\.com\/articleDetail\//i.test(link));
  if (detail) return detail;

  const internal = links.find((link) => /^https?:\/\/(?:www\.)?scys\.com\//i.test(link));
  if (internal) return internal;

  return links[0] ?? '';
}

function formatScysInteractions(like: unknown, comments: unknown, favorites: unknown, fallback?: unknown): string {
  const likeCount = Number(like);
  const commentCount = Number(comments);
  const favoriteCount = Number(favorites);
  if ([likeCount, commentCount, favoriteCount].every((n) => Number.isFinite(n) && n >= 0)) {
    return `点赞${Math.floor(likeCount)} 评论${Math.floor(commentCount)} 收藏${Math.floor(favoriteCount)}`;
  }

  const text = cleanText(fallback);
  if (!text) return '';
  const pieces = text.match(/[0-9]+(?:\.[0-9]+)?(?:万|亿)?/g);
  if (!pieces || pieces.length === 0) return text;
  return `点赞${pieces[0] ?? '0'} 评论${pieces[1] ?? '0'} 收藏${pieces[2] ?? '0'}`;
}

function trimWithLimit(value: unknown, maxLength: number): string {
  const text = polishScysText(value);
  if (!text) return '';
  return text.slice(0, maxLength);
}

function polishScysText(value: unknown): string {
  let text = cleanText(value);
  if (!text) return '';
  for (const [pattern, replacement] of SCYS_TEXT_FIXUPS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export async function ensureScysFeedReady(page: IPage): Promise<void> {
  await page.evaluate(`
    (async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 12; i += 1) {
        const hasCards = document.querySelectorAll('.post-list-container .compact-card, .compact-card').length > 0;
        const hasControls = document.querySelector('.vc-secondary-filter .filter-item, .titles.selector .button, .select.wrap .button');
        if (hasCards || hasControls) return;
        await sleep(250);
      }
    })()
  `);
}

export async function ensureScysLogin(page: IPage): Promise<void> {
  const state = await page.evaluate(`
    (() => {
      const text = (document.body?.innerText || '').slice(0, 12000);
      const strongLoginText = /扫码登录|手机号登录|验证码登录|微信登录|账号登录|登录\\/注册/.test(text);
      const genericLoginText = /请登录|登录后/.test(text);
      const loginByDom = !!document.querySelector(
        '.login-container, .login-box, .qrcode-login, form[action*="login"], input[type="password"], input[type="tel"][placeholder*="手机号"]'
      );
      const hasContentSignals = !!document.querySelector(
        '.course-detail-page, .vc-course-main, .post-list-container, .compact-card, .activity-left, .week-card, .vc-secondary-filter'
      );
      const routeLooksLikeLogin = location.pathname.includes('/login');
      return { strongLoginText, genericLoginText, loginByDom, hasContentSignals, routeLooksLikeLogin };
    })()
  `) as {
    strongLoginText?: boolean;
    genericLoginText?: boolean;
    loginByDom?: boolean;
    hasContentSignals?: boolean;
    routeLooksLikeLogin?: boolean;
  } | null;

  if (!state) return;
  const shouldBlock =
    !!state.routeLooksLikeLogin
    || !!state.loginByDom
    || (!!state.strongLoginText && !state.hasContentSignals)
    || (!!state.genericLoginText && !!state.loginByDom && !state.hasContentSignals);

  if (shouldBlock) {
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
        '.feishu-doc-content',
        '.document-container',
        '.vc-course-content',
        '.course-content-container',
        '.content-container',
        '.vc-course-main',
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

      const activeChapterEl =
        document.querySelector('.vc-chapter-item.is-active, .vc-chapter-item.is-current, .vc-chapter-item.active') ||
        null;
      const activeGroupTitle = clean(
        activeChapterEl?.closest('.vc-chapter-group')?.querySelector('.group-title, .chapter-group-title')?.textContent || ''
      );
      const activeSectionTitle = clean(
        activeChapterEl?.closest('.catalogue-section')?.querySelector('.section-title')?.textContent || ''
      );
      const activeChapterTitle = clean(activeChapterEl?.querySelector('.chapter-title')?.textContent || '');
      const catalogBreadcrumb = [activeSectionTitle, activeGroupTitle, activeChapterTitle].filter(Boolean);

      const breadcrumbTexts = Array.from(
        document.querySelectorAll(
          '.simple-catalog-toggle .breadcrumb-item, .breadcrumb-item, .breadcrumb a, .breadcrumb span, .vc-breadcrumb a, .vc-breadcrumb span'
        )
      )
        .map((el) => clean(el.textContent || ''))
        .filter(Boolean);

      const courseTitle =
        pickFirstText([
          '.vc-course-main .course-name',
          '.course-name',
          '.vc-course-sidebar .course-title',
          '.course-header .course-title',
          '.course-title',
        ]) ||
        clean((document.title || '').split(' - ')[0] || '');

      const chapterTitleFromContent = pickFirstText([
        '.vc-course-content .content-title',
        '.course-content-container .content-title',
        '.content-title',
        '.current-chapter',
        '.vc-course-main h1',
        'h1',
      ]);

      const currentChapter =
        chapterItems.find((item) => item.isCurrent)?.title ||
        pickFirstText(['.vc-chapter-item.is-active .chapter-title', '.vc-chapter-item.active .chapter-title']) ||
        chapterTitleFromContent;

      const chapterIdFromQuery = new URL(location.href).searchParams.get('chapterId') || '';
      const chapterId = chapterIdFromQuery || chapterItems.find((item) => item.isCurrent)?.id || '';

      return {
        courseTitle,
        chapterTitle: chapterTitleFromContent,
        currentChapter,
        breadcrumb: catalogBreadcrumb.length >= 2 ? catalogBreadcrumb : breadcrumbTexts,
        content: clean(contentEl?.innerText || ''),
        chapters: chapterItems,
        chapterId,
        pageUrl: location.href,
      };
    })()
  `) as {
    courseTitle?: string;
    chapterTitle?: string;
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
  const content = polishScysText(payload.content ?? '').slice(0, maxLength);
  const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const tocSummary = chapters
    .slice(0, 8)
    .map((item, index) => `${index + 1}.${polishScysText(item.title)}${item.id ? `(${item.id})` : ''}`)
    .join(' | ');

  if (!content && chapters.length === 0) {
    throw new EmptyResultError('scys/course', 'No course content or table of contents was detected');
  }

  return {
    course_title: polishScysText(payload.courseTitle ?? ''),
    chapter_title: polishScysText(payload.currentChapter ?? payload.chapterTitle ?? ''),
    breadcrumb: (payload.breadcrumb ?? []).map((s) => polishScysText(s)).filter(Boolean).join(' > '),
    content,
    chapter_id: polishScysText(payload.chapterId ?? ''),
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
  const maxLength = Math.max(120, Number(opts.maxLength ?? 600));

  await gotoAndWait(page, url, waitSeconds);
  await ensureScysLogin(page);
  await ensureScysFeedReady(page);

  // API-first extraction:
  // feed pages use /shengcai-web/client/homePage/searchTopic as list source.
  await page.installInterceptor('shengcai-web/client');
  await page.evaluate(`
    (async () => {
      const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const isActive = (el) => /active|is-active|selected/.test(el?.className || '');

      const search = new URL(location.href).searchParams;
      const expectedFilter = (search.get('filter') || '').toLowerCase();

      const homeFilters = Array.from(document.querySelectorAll('.vc-secondary-filter .filter-item'));
      if (homeFilters.length > 0) {
        const targetLabel = expectedFilter === 'essence' ? '精华' : '全部';
        const target = homeFilters.find((el) => clean(el.textContent || '') === targetLabel) || homeFilters[0];
        const active = homeFilters.find((el) => isActive(el));
        const alt = homeFilters.find((el) => el !== target);
        if (active && target && active === target && alt) {
          alt.click();
          await sleep(900);
        }
        if (target) {
          target.click();
          await sleep(1200);
        }
      }

      const profileTabs = Array.from(document.querySelectorAll('.titles.selector .button, .select.wrap .button, .button'))
        .filter((el) => ['帖子', '收藏'].includes(clean(el.textContent || '')));
      if (profileTabs.length > 0) {
        const posts = profileTabs.find((el) => clean(el.textContent || '') === '帖子') || profileTabs[0];
        const alt = profileTabs.find((el) => el !== posts);
        if (posts && isActive(posts) && alt) {
          alt.click();
          await sleep(1000);
        }
        if (posts) {
          posts.click();
          await sleep(1200);
        }
      }

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
      window.scrollTo(0, 0);
      await sleep(300);
    })()
  `);

  const intercepted = await page.getInterceptedRequests();
  const latest = intercepted
    .filter((entry) => {
      const data = (entry as any)?.data;
      return data && Array.isArray(data.items) && data.items.some((item: any) => item?.topicDTO);
    })
    .at(-1) as any;

  let normalized: ScysFeedRow[] = [];
  if (latest?.data?.items?.length) {
    normalized = latest.data.items.slice(0, limit).map((item: any, index: number) => {
      const topic = item?.topicDTO ?? {};
      const user = item?.topicUserDTO ?? {};
      const menuValues = Array.isArray(topic.menuList)
        ? topic.menuList.map((m: any) => cleanText(m?.value)).filter(Boolean)
        : [];
      const topicId = cleanText(topic.topicId || topic.entityId);
      const entityType = cleanText(topic.entityType || 'xq_topic');
      return {
        rank: index + 1,
        author: polishScysText(user.name),
        time: formatScysRelativeTime(topic.gmtCreate),
        badge: topic.isDigested ? '精华' : '',
        title: polishScysText(stripScysRichText(topic.showTitle)),
        preview: trimWithLimit(stripScysRichText(topic.articleContent), maxLength),
        tags: Array.from(new Set(menuValues.map((v: string) => polishScysText(v)).filter(Boolean))).join(', '),
        interactions: formatScysInteractions(topic.likeCount, topic.commentsCount, topic.favoriteCount),
        link: pickPreferredScysLink([
          item?.detailUrl,
          buildScysTopicLink(entityType, topicId),
          topic?.externalLink,
        ]),
      };
    }).filter((row: ScysFeedRow) => row.title || row.preview);
  }

  // DOM fallback for cases where interceptor is blocked or request timing misses.
  if (normalized.length === 0) {
    await page.autoScroll({ times: 2, delayMs: 1200 });
    const rows = await page.evaluate(`
      (() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const abs = (href) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('/')) return location.origin + href;
          return '';
        };

        const cards = Array.from(document.querySelectorAll('.post-list-container .compact-card, .compact-card'));
        return cards.map((card) => {
          const userLine = clean(card.querySelector('.user-line')?.textContent || '');
          const author = clean(
            card.querySelector('.user-line .user-name, .avatar-group .user-name, .author-name')?.textContent || ''
          );
          const time = clean(card.querySelector('.user-line .time-label, .user-line .time')?.textContent || '');
          const badge = clean(card.querySelector('.vc-essence-badge, .badge')?.textContent || '');
          const title = clean(card.querySelector('.title-text, .title-line .title, .title-line')?.textContent || '');
          const preview = clean(card.querySelector('.content-preview, .preview, .content')?.textContent || '');
          const tags = Array.from(card.querySelectorAll('.tags .tag, .tags span, .tag-list .tag'))
            .map((el) => clean(el.textContent || ''))
            .filter(Boolean);
          const interactions = clean(card.querySelector('.compact-interactions, .interactions')?.textContent || '');
          const metaLine = clean(card.querySelector('.meta-line')?.textContent || '');
          const links = Array.from(card.querySelectorAll('a[href]'))
            .map((el) => abs(el.getAttribute('href') || ''))
            .filter(Boolean);

          return {
            author,
            time,
            user_line: userLine,
            badge,
            title,
            preview,
            tags,
            interactions,
            meta_line: metaLine,
            links,
          };
        }).filter((item) => item.title || item.preview);
      })()
    `) as Array<{
      author?: string;
      time?: string;
      user_line?: string;
      badge?: string;
      title?: string;
      preview?: string;
      tags?: string[];
      interactions?: string;
      meta_line?: string;
      links?: string[];
    }> | null;

    normalized = (rows ?? []).slice(0, limit).map((row, index) => {
      const userLine = cleanText(row.user_line ?? '')
        .replace(/复制链接|跳转星球|投诉建议/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const [authorByLine, timeByLine] = userLine.split('·').map((part) => cleanText(part));
      return {
        rank: index + 1,
        author: polishScysText(row.author ?? authorByLine),
        time: cleanText(row.time ?? timeByLine),
        badge: polishScysText(row.badge ?? ''),
        title: polishScysText(row.title ?? '').replace(/^(精华|热门)\s*/, ''),
        preview: trimWithLimit(row.preview ?? '', maxLength),
        tags: Array.from(new Set((row.tags ?? []).map((tag: string) => polishScysText(tag)).filter(Boolean))).join(', '),
        interactions: formatScysInteractions(undefined, undefined, undefined, row.interactions || row.meta_line),
        link: pickPreferredScysLink(row.links ?? []),
      };
    }).filter((row) => row.title || row.preview);
  }

  if (normalized.length === 0) {
    throw new EmptyResultError('scys/feed', 'No feed cards were detected on this page');
  }

  return normalized;
}

export async function extractScysOpportunity(page: IPage, inputUrl: string, opts: ExtractOptions = {}): Promise<ScysOpportunityRow[]> {
  const url = normalizeScysUrl(inputUrl);
  const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));
  const limit = Math.max(1, Number(opts.limit ?? 20));
  const tab = normalizeOpportunityTab(opts.tab);

  await gotoAndWait(page, url, waitSeconds);
  await ensureScysLogin(page);

  // API-first extraction. The page internally requests:
  //   /shengcai-web/client/homePage/searchTopic
  // We intercept this payload to get stable fields (time, tags, images, topic ids).
  await page.installInterceptor('shengcai-web/client/homePage/searchTopic');
  await page.evaluate(`
    (async () => {
      const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const target = ${JSON.stringify(tab.label)};
      const filters = Array.from(document.querySelectorAll('.vc-secondary-filter .filter-item'));
      const hit = filters.find((el) => clean(el.textContent || '') === target);
      const active = filters.find((el) => (el.className || '').includes('active'));
      const alt = filters.find((el) => el !== hit);

      // Trigger request even when the current tab is already active:
      // switch away once, then switch back to target.
      if (active && hit && active === hit && alt) {
        alt.click();
        await sleep(1000);
      }

      if (hit) {
        hit.click();
      } else if (filters.length > 0) {
        filters[0].click();
      }

      await sleep(1400);
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
    })()
  `);

  const intercepted = await page.getInterceptedRequests();
  const latest = intercepted
    .filter((entry) => {
      const data = (entry as any)?.data;
      return data && Array.isArray(data.items) && data.items.length > 0;
    })
    .at(-1) as any;

  let normalized: ScysOpportunityRow[] = [];
  if (latest?.data?.items?.length) {
    normalized = latest.data.items.slice(0, limit).map((item: any, index: number) => {
      const topic = item?.topicDTO ?? {};
      const user = item?.topicUserDTO ?? {};
      const menuValues = Array.isArray(topic.menuList)
        ? topic.menuList.map((m: any) => cleanText(m?.value)).filter(Boolean)
        : [];
      const { flags, tags } = splitOpportunityFlagsAndTags(menuValues);

      const likeCount = Number(topic.likeCount ?? 0) || 0;
      const commentCount = Number(topic.commentsCount ?? 0) || 0;
      const favoriteCount = Number(topic.favoriteCount ?? 0) || 0;

      const entityType = cleanText(topic.entityType);
      const topicId = cleanText(topic.topicId || topic.entityId);
      const imageUrls = Array.isArray(topic.imageList)
        ? topic.imageList.map((u: unknown) => cleanText(u)).filter(Boolean)
        : [];

      return {
        rank: index + 1,
        author: polishScysText(user.name),
        time: formatScysRelativeTime(topic.gmtCreate),
        flags: flags.map((f: string) => polishScysText(f)).filter(Boolean).join(', '),
        title: polishScysText(stripScysRichText(topic.showTitle)),
        content: polishScysText(stripScysRichText(topic.articleContent)),
        ai_summary: polishScysText(parseAiSummaryText(topic.aiSummaryContent)),
        tags: tags.map((t: string) => polishScysText(t)).filter(Boolean).join(', '),
        interactions: `点赞${likeCount} 评论${commentCount} 收藏${favoriteCount}`,
        link: cleanText(item.detailUrl) || buildScysTopicLink(entityType, topicId),
        topic_id: topicId,
        entity_type: entityType,
        image_urls: imageUrls,
      };
    });
  }

  // DOM fallback: keep the previous extractor as backup when the API payload is blocked.
  if (normalized.length === 0) {
    await page.autoScroll({ times: 2, delayMs: 1200 });
    const rows = await page.evaluate(`
      (() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const abs = (href) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('/')) return location.origin + href;
          return '';
        };
        const cards = Array.from(document.querySelectorAll('.post-list-container .post-item, .post-item'));
        return cards.map((card) => {
          const top = card.querySelector('.post-item-top') || card;
          const author = clean(top.querySelector('.name, .author, .nickname, .user-name')?.textContent || '');
          const time = clean(top.querySelector('.date, .time, .meta-time')?.textContent || '');
          const flags = Array.from(card.querySelectorAll('.hit-icon, .icon, .post-title .tag, .post-title .flag'))
            .map((el) => clean(el.textContent || ''))
            .filter(Boolean);
          const title = clean(card.querySelector('.post-title, .title-line')?.textContent || '');
          const content = clean(card.querySelector('.content-stream, .post-content, .content-preview')?.textContent || '');
          const aiSummary = clean(card.querySelector('.ai-summary-container .content, .ai-summary-container, .ai-summary')?.textContent || '');
          const tags = Array.from(card.querySelectorAll('.label-box .tag-item, .label-box span, .tags .tag'))
            .map((el) => clean(el.textContent || ''))
            .filter(Boolean);
          const interactions = clean(card.querySelector('.interactions, .compact-interactions')?.textContent || '');
          const images = Array.from(card.querySelectorAll('.image-list img, img.multi-img'))
            .map((img) => clean(img.getAttribute('src') || img.getAttribute('data-src') || ''))
            .filter(Boolean);
          const link = abs(card.querySelector('a[href]')?.getAttribute('href') || '');
          return { author, time, flags, title, content, ai_summary: aiSummary, tags, interactions, link, image_urls: images };
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
      image_urls?: string[];
    }> | null;

    normalized = (rows ?? []).slice(0, limit).map((row, index) => {
      const imageUrls = (row.image_urls ?? []).map((u) => cleanText(u)).filter(Boolean);
      const topicId = inferTopicIdFromImageUrls(imageUrls);
      const tags = Array.from(new Set((row.tags ?? []).map((tag: string) => cleanText(tag)).filter(Boolean)));
      return {
        rank: index + 1,
        author: polishScysText(row.author ?? ''),
        time: cleanText(row.time ?? ''),
        flags: (row.flags ?? []).map((f: string) => polishScysText(f)).filter(Boolean).join(', '),
        title: polishScysText(stripScysRichText(row.title ?? '')),
        content: polishScysText(stripScysRichText(row.content ?? '')),
        ai_summary: polishScysText(stripScysRichText(row.ai_summary ?? '')),
        tags: tags.map((tag: string) => polishScysText(tag)).filter(Boolean).join(', '),
        interactions: extractInteractions(row.interactions ?? ''),
        link: cleanText(row.link ?? '') || buildScysTopicLink('xq_topic', topicId),
        topic_id: topicId,
        entity_type: topicId ? 'xq_topic' : '',
        image_urls: imageUrls,
      };
    });
  }

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
    (async () => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const normalizeTab = (value) => clean(value).replace(/\s*New$/i, '').trim();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      const contentTabs = Array.from(document.querySelectorAll('.activity-left .container.v-no-scrollbar span, .container.v-no-scrollbar span'))
        .filter((el) => clean(el.textContent || ''));
      const roadmapTab = contentTabs.find((el) => clean(el.textContent || '').includes('航线图'));
      if (roadmapTab && typeof roadmapTab.click === 'function') {
        roadmapTab.click();
        await sleep(500);
      }

      const title = clean(
        document.querySelector('.activity-left .name, h1, .activity-title, .landing-title')?.textContent ||
        document.title ||
        ''
      );
      const subtitle = clean(
        document.querySelector('.activity-left .des, .subtitle, .sub-title, .activity-subtitle, .landing-subtitle')?.textContent ||
        ''
      );

      const tabGroups = Array.from(
        document.querySelectorAll('.activity-left .tabs, .activity-left .container.v-no-scrollbar, .tabs')
      )
        .map((group) =>
          Array.from(group.querySelectorAll('.tab-item, .tab, [role="tab"], .item, span'))
            .map((el) => normalizeTab(el.textContent || ''))
            .filter(Boolean)
        )
        .filter((group) => group.length > 0);
      const tabsRaw =
        tabGroups.find((group) => group.some((text) => /简介|航线图|问答/.test(text))) ||
        tabGroups[0] ||
        [];
      const tabs = Array.from(new Set(tabsRaw));

      const stageEls = Array.from(
        document.querySelectorAll('.activity-line-content .week-card, .activity-left .week-card, .week-card')
      );
      const stages = stageEls.map((stage) => {
        const phaseTitle = clean(stage.querySelector('.title-name, .stage-name')?.textContent || '');
        const stageTitleRaw = clean(stage.querySelector('.title-week .text, .title-week, .week-title, .stage-title')?.textContent || '');
        const duration = clean(
          stage.querySelector('.title-week .highlightInActivity, .duration, .time, .date-range, .stage-duration')?.textContent || ''
        );
        const stageTitle = clean(
          [phaseTitle, stageTitleRaw.replace(duration, '').trim()]
            .map((v) => clean(v))
            .filter(Boolean)
            .join(' ')
        );
        const tasks = Array.from(stage.querySelectorAll('.card .row, .row'))
          .map((row) => {
            const key = clean(row.querySelector('.key')?.textContent || '');
            const text = clean(row.querySelector('.card-title')?.textContent || row.textContent || '');
            if (!text) return '';
            if (key && !text.startsWith(key)) return key + '. ' + text;
            return text;
          })
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
    title: polishScysText(payload.title),
    subtitle: polishScysText(payload.subtitle),
    tabs: (payload.tabs ?? []).map((tab) => polishScysText(tab)).filter(Boolean),
    stages: (payload.stages ?? []).map((stage) => ({
      title: polishScysText(stage.title),
      duration: polishScysText(stage.duration),
      tasks: (stage.tasks ?? []).map((task) => polishScysText(task)).filter(Boolean),
    })),
    url: normalizeScysUrl(payload.url || url),
  };
}
