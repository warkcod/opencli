import * as path from 'node:path';
import { formatCookieHeader } from '../../download/index.js';
import { downloadMedia } from '../../download/media-download.js';
import type { IPage } from '../../types.js';
import type { ScysCourseSummary } from './types.js';

export async function downloadScysCourseImages(
  page: IPage,
  data: ScysCourseSummary | ScysCourseSummary[],
  output: string,
): Promise<ScysCourseSummary | ScysCourseSummary[]> {
  const rows = Array.isArray(data) ? data : [data];
  const cookies = formatCookieHeader(await page.getCookies({ domain: 'scys.com' }));
  const withDownloads: ScysCourseSummary[] = [];

  for (const row of rows) {
    const imageUrls = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
    if (imageUrls.length === 0) {
      withDownloads.push({ ...row, image_dir: '' });
      continue;
    }

    const courseId = row.course_id || 'course';
    const chapterId = row.chapter_id || 'root';
    const subdir = path.join(courseId, chapterId);
    const media = imageUrls.map((url, idx) => ({
      type: 'image' as const,
      url,
      filename: `${courseId}_${chapterId}_${idx + 1}.jpg`,
    }));
    const results = await downloadMedia(media, {
      output,
      subdir,
      cookies,
      filenamePrefix: `${courseId}_${chapterId}`,
      timeout: 60_000,
      verbose: false,
    });
    const successCount = results.filter((result) => result.status === 'success').length;
    withDownloads.push({
      ...row,
      image_count: successCount,
      image_dir: path.join(output, subdir),
    });
  }

  return Array.isArray(data) ? withDownloads : withDownloads[0];
}
