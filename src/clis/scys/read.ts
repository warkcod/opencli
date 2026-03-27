import { ArgumentError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import { detectScysPageType, inferScysReadUrl } from './common.js';
import {
  extractScysActivity,
  extractScysCourse,
  extractScysFeed,
  extractScysOpportunity,
} from './extractors.js';

cli({
  site: 'scys',
  name: 'read',
  description: 'Read a SCYS page with automatic page-type routing',
  domain: 'scys.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'url', required: true, positional: true, help: 'Any scys.com URL' },
    { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
    { name: 'limit', type: 'int', default: 20, help: 'Max rows for list pages' },
    { name: 'max-length', type: 'int', default: 4000, help: 'Max content length for long text fields' },
  ],
  func: async (page, kwargs) => {
    const url = inferScysReadUrl(String(kwargs.url));
    const waitSeconds = Math.max(1, Number(kwargs.wait ?? 3));
    const limit = Math.max(1, Number(kwargs.limit ?? 20));
    const maxLength = Math.max(300, Number(kwargs['max-length'] ?? 4000));

    const pageType = detectScysPageType(url);

    if (pageType === 'course') {
      const row = await extractScysCourse(page, url, { waitSeconds, maxLength });
      return { page_type: pageType, ...row };
    }

    if (pageType === 'feed') {
      return extractScysFeed(page, url, { waitSeconds, limit, maxLength });
    }

    if (pageType === 'opportunity') {
      return extractScysOpportunity(page, url, { waitSeconds, limit, maxLength });
    }

    if (pageType === 'activity') {
      const row = await extractScysActivity(page, url, { waitSeconds, maxLength });
      return { page_type: pageType, ...row, tabs: row.tabs.join(' | '), stages: JSON.stringify(row.stages) };
    }

    throw new ArgumentError(
      `Unsupported SCYS page for scys/read: ${url}`,
      'Supported patterns: /course/detail/:id, /?filter=essence, /personal/:id?tab=posts, /opportunity, /activity/landing/:id'
    );
  },
});
