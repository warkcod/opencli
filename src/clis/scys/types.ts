export type ScysPageType = 'course' | 'feed' | 'opportunity' | 'activity' | 'unknown';

export interface ScysCourseSummary {
  course_title: string;
  chapter_title: string;
  breadcrumb: string;
  content: string;
  chapter_id: string;
  course_id: string;
  toc_summary: string;
  url: string;
}

export interface ScysTocRow {
  rank: number;
  group: string;
  chapter_id: string;
  chapter_title: string;
  status: string;
  is_current: boolean;
}

export interface ScysFeedRow {
  rank: number;
  author: string;
  time: string;
  badge: string;
  title: string;
  preview: string;
  tags: string;
  interactions: string;
  link: string;
}

export interface ScysOpportunityRow {
  rank: number;
  author: string;
  time: string;
  flags: string;
  title: string;
  content: string;
  ai_summary: string;
  tags: string;
  interactions: string;
  link: string;
  topic_id?: string;
  entity_type?: string;
  image_urls?: string[];
  image_count?: number;
  image_dir?: string;
}

export interface ScysActivityStage {
  title: string;
  duration: string;
  tasks: string[];
}

export interface ScysActivitySummary {
  title: string;
  subtitle: string;
  tabs: string[];
  stages: ScysActivityStage[];
  url: string;
}
