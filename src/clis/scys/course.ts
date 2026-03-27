import { cli, Strategy } from '../../registry.js';
import { extractScysCourse } from './extractors.js';

cli({
  site: 'scys',
  name: 'course',
  description: 'Read SCYS course detail content and chapter context',
  domain: 'scys.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'url', required: true, positional: true, help: 'Course URL: /course/detail/:id[?chapterId=...]' },
    { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
    { name: 'max-length', type: 'int', default: 4000, help: 'Max content length' },
  ],
  columns: ['course_title', 'chapter_title', 'breadcrumb', 'content', 'chapter_id', 'course_id', 'toc_summary', 'url'],
  func: async (page, kwargs) => {
    return extractScysCourse(page, String(kwargs.url), {
      waitSeconds: Number(kwargs.wait ?? 3),
      maxLength: Number(kwargs['max-length'] ?? 4000),
    });
  },
});
