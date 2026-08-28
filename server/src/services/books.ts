import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import type { CacheImpl } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";

type RecordState = 1 | 2 | 3; // 1想看 2在看 3已看
type BookStatus = "want" | "reading" | "read";

interface RawMedia {
    objectId: string;
    key?: string;
    title: string;
    type: string;
    poster?: string;
    url?: string;
    author?: string[];
    pubdate?: string[];
    press?: string;
}

interface RawComment {
    content: string;
    createTime: number;
    reference?: string;
}

interface RawRecord {
    objectId: string;
    state: RecordState;
    media: string;
    times?: { state: RecordState; time: number }[];
    comments?: RawComment[];
    rating?: number;
    finishTime?: number;
}

interface RawExport {
    media: RawMedia[];
    record: RawRecord[];
}

interface Note {
    content: string;
    createTime: number;
}

interface FullBook {
    id: string;
    key: string;
    title: string;
    author: string;
    cover: string;
    url: string;
    press: string;
    pubdate: string;
    status: BookStatus;
    rating: number | null;
    dateLabel: string | null;
    reviews: Note[];
    excerpts: Note[];
}

interface CachedBooksData {
    sourceKey: string;
    uploaded: string; // ISO
    books: FullBook[];
}

const CACHE_KEY = "books_full_data";
const COVER_PREFIX = "covers/";

function coverKey(id: string): string {
    return `${COVER_PREFIX}${id}`;
}

// 抓取原始封面并缓存到 R2，只在详情页被访问、且该书还没有缓存过封面时调用一次
async function fetchAndCacheCover(bucket: R2Bucket, id: string, originalUrl: string): Promise<R2ObjectBody | null> {
    let response: Response;
    try {
        response = await fetch(originalUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                // 豆瓣图床基本都要求带 Referer，否则会拒绝或返回占位图/错误页
                "Referer": "https://book.douban.com/",
                "Accept-Language": "zh-CN,zh;q=0.9",
            },
        });
    } catch (e) {
        console.error(`Failed to fetch cover for ${id}:`, e);
        return null;
    }

    if (!response.ok || !response.body) {
        console.error(`Cover fetch failed for ${id}: status ${response.status}`);
        return null;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();

    // 简单校验，避免把反爬返回的错误页/占位图当成封面缓存下来
    if (buffer.byteLength < 1024) {
        console.error(`Cover for ${id} looks invalid (${buffer.byteLength} bytes), skip caching`);
        return null;
    }

    await bucket.put(coverKey(id), buffer, {
        httpMetadata: { contentType },
    });

    return bucket.get(coverKey(id));
}

// 一次性列出 covers/ 前缀下所有已缓存的封面 id，供列表页判断走代理地址还是原图直链
async function getCachedCoverIds(bucket: R2Bucket): Promise<Set<string>> {
    const ids = new Set<string>();
    let cursor: string | undefined;

    do {
        const listing = await bucket.list({ prefix: COVER_PREFIX, cursor });
        for (const obj of listing.objects) {
            ids.add(obj.key.slice(COVER_PREFIX.length));
        }
        cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    return ids;
}

function getReadingDataBucket(env: Env): R2Bucket {
    const bucket = (env as unknown as Record<string, R2Bucket | undefined>).READING_DATA_BUCKET;
    if (!bucket) {
        throw new Error("READING_DATA_BUCKET binding is not configured");
    }
    return bucket;
}

// 在 bucket 里找最新上传的 .json 导出文件
async function getLatestJsonObject(bucket: R2Bucket): Promise<{ key: string; uploaded: Date } | null> {
    let cursor: string | undefined;
    let latest: { key: string; uploaded: Date } | null = null;

    do {
        const listing = await bucket.list({ cursor });
        for (const obj of listing.objects) {
            if (!obj.key.toLowerCase().endsWith(".json")) continue;
            if (!latest || obj.uploaded > latest.uploaded) {
                latest = { key: obj.key, uploaded: obj.uploaded };
            }
        }
        cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    return latest;
}

function statusFromState(state: RecordState): BookStatus {
    if (state === 3) return "read";
    if (state === 2) return "reading";
    return "want";
}

function formatDate(ms: number | null | undefined): string | null {
    if (!ms) return null;
    return new Date(ms).toISOString().slice(0, 10);
}

function resolveDateLabel(status: BookStatus, record: RawRecord): string | null {
    const timesByState = new Map((record.times || []).map(t => [t.state, t.time]));
    if (status === "read") return formatDate(record.finishTime || timesByState.get(3));
    if (status === "reading") return formatDate(timesByState.get(2));
    return formatDate(timesByState.get(1) || record.times?.[0]?.time);
}

// 按空行分段，"//" 开头的段落算书评，其余算书摘
function parseComment(content: string): { reviews: string[]; excerpts: string[] } {
    const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const reviews: string[] = [];
    const excerpts: string[] = [];

    for (const p of paragraphs) {
        if (p.startsWith("//")) {
            reviews.push(p.replace(/^\/\/\s*/, "").trim());
        } else {
            excerpts.push(p);
        }
    }
    return { reviews, excerpts };
}

function parseRawExport(raw: RawExport): FullBook[] {
    const mediaById = new Map(raw.media.filter(m => m.type === "book").map(m => [m.objectId, m]));
    const books: FullBook[] = [];

    for (const record of raw.record) {
        const media = mediaById.get(record.media);
        if (!media) continue; // 不是书，跳过（电影/剧集）

        const status = statusFromState(record.state);
        const reviews: Note[] = [];
        const excerpts: Note[] = [];

        for (const comment of record.comments || []) {
            const { reviews: r, excerpts: e } = parseComment(comment.content);
            r.forEach(content => reviews.push({ content, createTime: comment.createTime }));
            e.forEach(content => excerpts.push({ content, createTime: comment.createTime }));
        }

        books.push({
            id: media.objectId,
            key: media.key || "",
            title: media.title,
            author: (media.author || []).join(" / "),
            cover: media.poster || "",
            url: media.url || "",
            press: media.press || "",
            pubdate: (media.pubdate || [])[0] || "",
            status,
            rating: record.rating ? record.rating : null,
            dateLabel: resolveDateLabel(status, record),
            reviews,
            excerpts,
        });
    }

    return books;
}

// 加载并解析 readingdata bucket 里最新的导出 JSON，带缓存（按来源文件 key + 上传时间判断是否需要重新解析）
async function loadFullBooksData(env: Env, cache: CacheImpl): Promise<FullBook[]> {
    const bucket = getReadingDataBucket(env);

    const latest = await getLatestJsonObject(bucket);
    if (!latest) return [];

    const cached = await cache.get(CACHE_KEY) as CachedBooksData | null;
    if (cached && cached.sourceKey === latest.key && cached.uploaded === latest.uploaded.toISOString()) {
        return cached.books;
    }

    const object = await bucket.get(latest.key);
    if (!object) return [];

    const raw = await object.json<RawExport>();
    const books = parseRawExport(raw);

    await cache.set(CACHE_KEY, {
        sourceKey: latest.key,
        uploaded: latest.uploaded.toISOString(),
        books,
    } satisfies CachedBooksData);

    return books;
}

// 列表卡片：已缓存封面的书走 /api/books/cover/:id 代理地址，还没缓存的先用原始豆瓣直链兜底
function toCard(book: FullBook, cachedCoverIds: Set<string>) {
    const { reviews, excerpts, ...card } = book;
    const cover = book.cover
        ? (cachedCoverIds.has(book.id) ? `/api/books/cover/${book.id}` : book.cover)
        : "";
    return { ...card, cover };
}

export function BooksService(): Hono {
    const app = new Hono();

    // GET /books —— 列表（分组：read / reading / want）
    app.get('/', async (c: AppContext) => {
        const env = c.get('env');
        const cache = c.get('cache');
        const bucket = getReadingDataBucket(env);

        try {
            const books = await profileAsync(c, 'books_load', () => loadFullBooksData(env, cache));
            const cachedCoverIds = await profileAsync(c, 'books_cover_ids', () => getCachedCoverIds(bucket));

            const read = books.filter(b => b.status === 'read').sort((a, b) => (b.dateLabel || '').localeCompare(a.dateLabel || ''));
            const reading = books.filter(b => b.status === 'reading').sort((a, b) => (b.dateLabel || '').localeCompare(a.dateLabel || ''));
            const want = books.filter(b => b.status === 'want').sort((a, b) => (b.dateLabel || '').localeCompare(a.dateLabel || ''));

            return c.json({
                read: read.map(b => toCard(b, cachedCoverIds)),
                reading: reading.map(b => toCard(b, cachedCoverIds)),
                want: want.map(b => toCard(b, cachedCoverIds)),
                counts: { read: read.length, reading: reading.length, want: want.length },
            });
        } catch (e: any) {
            console.error('Failed to load books data:', e.message);
            return c.text(e.message, 500);
        }
    });

    // GET /books/cover/:id —— 只读缓存，没有就 404（抓取只在详情页触发，这里不负责抓取）
    app.get('/cover/:id', async (c: AppContext) => {
        const env = c.get('env');
        const id = c.req.param('id');
        const bucket = getReadingDataBucket(env);

        const obj = await bucket.get(coverKey(id));
        if (!obj) return c.text('Not found', 404);

        return new Response(obj.body, {
            headers: {
                'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    });

    // GET /books/:id —— 详情（含书评/书摘）；封面未缓存时在此单本触发抓取
    app.get('/:id', async (c: AppContext) => {
        const env = c.get('env');
        const cache = c.get('cache');
        const id = c.req.param('id');
        const bucket = getReadingDataBucket(env);

        try {
            const books = await profileAsync(c, 'books_load', () => loadFullBooksData(env, cache));
            const book = books.find(b => b.id === id);
            if (!book) return c.text('Not found', 404);

            let cover = book.cover;
            if (book.cover) {
                const existing = await bucket.head(coverKey(id));
                if (existing) {
                    cover = `/api/books/cover/${id}`;
                } else {
                    const fetched = await fetchAndCacheCover(bucket, id, book.cover);
                    cover = fetched ? `/api/books/cover/${id}` : book.cover;
                }
            }

            return c.json({ ...book, cover });
        } catch (e: any) {
            console.error('Failed to load books data:', e.message);
            return c.text(e.message, 500);
        }
    });

    // DELETE /books/cache —— 应急手动清缓存用（正常情况下会自动检测新文件）
    app.delete('/cache', async (c: AppContext) => {
        if (!c.get('admin')) return c.text('Permission denied', 403);
        await c.get('cache').delete(CACHE_KEY);
        return c.text('Cleared');
    });

    return app;
}