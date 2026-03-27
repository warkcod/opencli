import { cli, Strategy } from '../../registry.js';
import { buildScysOpportunityUrl } from './common.js';
import { extractScysOpportunity } from './extractors.js';

cli({
  site: 'scys',
  name: 'opportunity',
  description: 'Extract SCYS opportunity feed with flags, summaries, and tags',
  domain: 'scys.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'url', positional: true, default: buildScysOpportunityUrl(), help: 'Opportunity URL' },
    { name: 'limit', type: 'int', default: 20, help: 'Max number of cards' },
    { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
  ],
  columns: ['rank', 'author', 'time', 'flags', 'title', 'content', 'ai_summary', 'tags', 'interactions', 'link'],
  func: async (page, kwargs) => {
    return extractScysOpportunity(page, String(kwargs.url ?? buildScysOpportunityUrl()), {
      waitSeconds: Number(kwargs.wait ?? 3),
      limit: Number(kwargs.limit ?? 20),
    });
  },
});
