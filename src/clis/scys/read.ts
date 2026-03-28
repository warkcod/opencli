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
      const data = await extractScysCourse(page, url, { waitSeconds, maxLength });
      return { page_type: pageType, data };
    }

    if (pageType === 'feed') {
      const data = await extractScysFeed(page, url, { waitSeconds, limit, maxLength });
      return { page_type: pageType, data };
    }

    if (pageType === 'opportunity') {
      const data = await extractScysOpportunity(page, url, { waitSeconds, limit, maxLength });
      return { page_type: pageType, data };
    }

    if (pageType === 'activity') {
      const data = await extractScysActivity(page, url, { waitSeconds, maxLength });
      return { page_type: pageType, data };
    }

    throw new ArgumentError(
      `Unsupported SCYS page for scys/read: ${url}`,
      'Supported patterns: /course/detail/:id, /?filter=essence, /personal/:id?tab=posts, /opportunity, /activity/landing/:id'
    );
  },
});
