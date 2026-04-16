import { describe, expect, it } from 'vitest';
import { extractScysArticle, extractScysFeed, extractScysOpportunity } from './extractors.js';

function createScysPageMock({
    loginState,
    evaluateResults = [],
    interceptedRequests = [],
} = {}) {
    const queue = [...evaluateResults];
    return {
        goto: async () => {},
        wait: async () => {},
        evaluate: async (js) => {
            if (js.includes('const text = (document.body?.innerText ||') && js.includes('hasContentSignals')) {
                return loginState ?? {
                    strongLoginText: false,
                    genericLoginText: false,
                    loginByDom: false,
                    hasContentSignals: true,
                    routeLooksLikeLogin: false,
                    loginCtaText: false,
                };
            }
            return queue.shift();
        },
        autoScroll: async () => {},
        installInterceptor: async () => {},
        getInterceptedRequests: async () => interceptedRequests,
        getCookies: async () => [],
        snapshot: async () => null,
        click: async () => {},
        typeText: async () => {},
        pressKey: async () => {},
        scrollTo: async () => null,
        getFormState: async () => null,
        tabs: async () => [],
        closeTab: async () => {},
        newTab: async () => {},
        selectTab: async () => {},
        networkRequests: async () => [],
        consoleMessages: async () => [],
        scroll: async () => {},
        waitForCapture: async () => {},
        screenshot: async () => '',
        getCurrentUrl: async () => 'https://scys.com/',
    };
}

describe('extractScysFeed', () => {
    it('keeps SCYS detail identity even when the list item also has an external source link', async () => {
        const page = createScysPageMock({
            evaluateResults: [undefined, undefined],
            interceptedRequests: [
                {
                    data: {
                        items: [
                            {
                                detailUrl: 'https://my.feishu.cn/docx/PSdVdb8j3oIcIExlOsuctM4gnge?from=from_copylink',
                                topicDTO: {
                                    topicId: '82255511485258522',
                                    entityType: 'xq_topic',
                                    externalLink: 'https://my.feishu.cn/docx/PSdVdb8j3oIcIExlOsuctM4gnge?from=from_copylink',
                                    showTitle: '新手怎么用视频号做高客单流量？从0-1踩坑的合规指南',
                                    articleContent: '视频号这篇辛苦大家移步飞书',
                                    gmtCreate: 1_776_145_020,
                                    likeCount: 12,
                                    commentsCount: 3,
                                    favoriteCount: 4,
                                    menuList: [{ value: '视频号' }, { value: '项目实操' }],
                                },
                                topicUserDTO: {
                                    name: '些些怡',
                                },
                            },
                        ],
                    },
                },
            ],
        });

        const rows = await extractScysFeed(page, 'https://scys.com/?filter=essence', {
            waitSeconds: 1,
            limit: 1,
            maxLength: 600,
        });

        expect(rows).toEqual([
            expect.objectContaining({
                topic_id: '82255511485258522',
                entity_type: 'xq_topic',
                url: 'https://scys.com/articleDetail/xq_topic/82255511485258522',
                raw_url: 'https://scys.com/articleDetail/xq_topic/82255511485258522',
                external_links: ['https://my.feishu.cn/docx/PSdVdb8j3oIcIExlOsuctM4gnge?from=from_copylink'],
                source_links: ['https://my.feishu.cn/docx/PSdVdb8j3oIcIExlOsuctM4gnge?from=from_copylink'],
            }),
        ]);
    });
});

describe('extractScysOpportunity', () => {
    it('recovers topic identity from page cache when DOM fallback only sees an external link', async () => {
        const page = createScysPageMock({
            evaluateResults: [
                undefined,
                [
                    {
                        author: '阿霖',
                        time: '1小时前',
                        flags: ['信息差'],
                        title: '信息差外面卖几千块的GPTPlus技术原理拆解',
                        content: '移步飞书：https://flex-fox.feishu.cn/wiki/BdGkw2dqDiDBPWkkOhvcrJ7tnCe?from=from_copylink',
                        ai_summary: '',
                        tags: ['ChatGPT', '项目实操'],
                        interactions: '点赞1931 评论0 收藏0',
                        link: 'https://flex-fox.feishu.cn/wiki/BdGkw2dqDiDBPWkkOhvcrJ7tnCe?from=from_copylink',
                        image_urls: [
                            'https://search01.shengcaiyoushu.com/upload/doc/Lfw7drrJKoO7dgx3nVYccY8hnAd/HRVOb2QkCoafpCxX0YIcqKOdnFd',
                        ],
                    },
                ],
                [
                    {
                        title: '外面卖几千块的GPTPlus技术原理拆解',
                        topic_id: '55522122458215244',
                        entity_type: 'xq_topic',
                        scys_url: 'https://scys.com/articleDetail/xq_topic/55522122458215244',
                        links: ['https://flex-fox.feishu.cn/wiki/BdGkw2dqDiDBPWkkOhvcrJ7tnCe?from=from_copylink'],
                    },
                ],
            ],
            interceptedRequests: [],
        });

        const rows = await extractScysOpportunity(page, 'https://scys.com/opportunity', {
            waitSeconds: 1,
            limit: 1,
            tab: '全部',
        });

        expect(rows).toEqual([
            expect.objectContaining({
                topic_id: '55522122458215244',
                entity_type: 'xq_topic',
                url: 'https://scys.com/articleDetail/xq_topic/55522122458215244',
                raw_url: 'https://scys.com/articleDetail/xq_topic/55522122458215244',
                external_links: ['https://flex-fox.feishu.cn/wiki/BdGkw2dqDiDBPWkkOhvcrJ7tnCe?from=from_copylink'],
                source_links: ['https://flex-fox.feishu.cn/wiki/BdGkw2dqDiDBPWkkOhvcrJ7tnCe?from=from_copylink'],
            }),
        ]);
    });
});

describe('extractScysArticle', () => {
    it('waits past shell placeholders and returns hydrated article content', async () => {
        const page = createScysPageMock({
            evaluateResults: [
                {
                    entityType: 'xq_topic',
                    topicId: '55522122288425554',
                    title: '生财官网·会员主题贴',
                    author: '',
                    time: '',
                    flags: [],
                    tags: [],
                    content: '',
                    aiSummary: '',
                    likeText: '',
                    commentText: '',
                    favoriteText: '',
                    images: [],
                    sourceLinks: [],
                    externalLinks: [],
                    pageUrl: 'https://scys.com/articleDetail/xq_topic/55522122288425554',
                },
                {
                    entityType: 'xq_topic',
                    topicId: '55522122288425554',
                    title: 'kikivoice.ai 这是一个免费克隆音频的网站',
                    author: '謃銧閃爍',
                    time: '2026-04-15 17:39',
                    flags: ['工具推荐', '风向标'],
                    tags: ['AI'],
                    content: '工具推荐 kikivoice.ai 这是一个免费克隆音频的网站',
                    aiSummary: '工具名称：kikivoice.ai（音频克隆网站）',
                    likeText: '216',
                    commentText: '5',
                    favoriteText: '0',
                    images: [],
                    sourceLinks: ['https://kikivoice.ai'],
                    externalLinks: ['https://kikivoice.ai'],
                    pageUrl: 'https://scys.com/articleDetail/xq_topic/55522122288425554',
                },
                {
                    entityType: 'xq_topic',
                    topicId: '55522122288425554',
                    title: 'kikivoice.ai 这是一个免费克隆音频的网站',
                    author: '謃銧閃爍',
                    time: '2026-04-15 17:39',
                    flags: ['工具推荐', '风向标'],
                    tags: ['AI'],
                    content: '工具推荐 kikivoice.ai 这是一个免费克隆音频的网站',
                    aiSummary: '工具名称：kikivoice.ai（音频克隆网站）',
                    likeText: '216',
                    commentText: '5',
                    favoriteText: '0',
                    images: [],
                    sourceLinks: ['https://kikivoice.ai'],
                    externalLinks: ['https://kikivoice.ai'],
                    pageUrl: 'https://scys.com/articleDetail/xq_topic/55522122288425554',
                },
            ],
        });

        const result = await extractScysArticle(page, 'https://scys.com/articleDetail/xq_topic/55522122288425554', {
            waitSeconds: 1,
            maxLength: 4000,
        });

        expect(result).toMatchObject({
            topic_id: '55522122288425554',
            title: 'kikivoice.ai 这是一个免费克隆音频的网站',
            author: '謃銧閃爍',
            content: '工具推荐 kikivoice.ai 这是一个免费克隆音频的网站',
            external_links: ['https://kikivoice.ai'],
            source_links: ['https://kikivoice.ai'],
        });
    });
});
