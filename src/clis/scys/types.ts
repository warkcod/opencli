export type ScysPageType = 'course' | 'feed' | 'opportunity' | 'activity' | 'article' | 'unknown';

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
  flags: string[];
  title: string;
  summary: string;
  tags: string[];
  interactions: ScysArticleInteractions;
  interactions_display: string;
  url: string;
  raw_url: string;
  images: string[];
  image_count: number;
}

export interface ScysOpportunityRow {
  rank: number;
  author: string;
  time: string;
  flags: string[];
  title: string;
  summary: string;
  ai_summary: string;
  tags: string[];
  interactions: ScysArticleInteractions;
  interactions_display: string;
  url: string;
  raw_url: string;
  topic_id?: string;
  entity_type?: string;
  images: string[];
  image_count: number;
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

export interface ScysArticleInteractions {
  likes: number;
  comments: number;
  favorites: number;
  display: string;
}

export interface ScysArticleSummary {
  entity_type: string;
  topic_id: string;
  url: string;
  raw_url: string;
  title: string;
  author: string;
  time: string;
  tags: string[];
  flags: string[];
  content: string;
  ai_summary: string;
  interactions: ScysArticleInteractions;
  image_count: number;
  images: string[];
  external_link_count: number;
  external_links: string[];
  source_links: string[];
}
