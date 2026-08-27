import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import type { CacheImpl } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";

type RecordState = 1 | 2 | 3; // 1?? 2?? 3??
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

function getReadingDataBucket(env: Env): R2Bucket {
    const bucket = (env as unknown as Record<string, R2Bucket | undefined>).READING_DATA_BUCKET;
    if (!bucket) {
        throw new Error("READING_DATA_BUCKET binding is not configured");
    }
    return bucket;
}

// ? bucket ??????? .json ??
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
        if (!media) continue;

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

function toCard(book: FullBook) {
    const { reviews, excerpts, ...card } = book;
    return card;
}

export function BooksService(): Hono {
    const app = new Hono();

    // GET /books
    app.get('/', async (c: AppContext) => {
        const env = c.get('env');
        const cache = c.get('cache');

        try {
            const books = await profileAsync(c, 'books_load', () => loadFullBooksData(env, cache));

            const read = books.filter(b => b.status === 'read').sort((a, b) => (b.dateLabel || '').localeCompare(a.dateLabel || ''));
            const reading = books.filter(b => b.status === 'reading').sort((a, b) => (b.dateLabel || '').localeCompare(a.dateLabel || ''));
            const want = books.filter(b => b.status === 'want').sort((a, b) => (b.dateLabel || '').localeCompare(a.dateLabel || ''));

            return c.json({
                read: read.map(toCard),
                reading: reading.map(toCard),
                want: want.map(toCard),
                counts: { read: read.length, reading: reading.length, want: want.length },
            });
        } catch (e: any) {
            console.error('Failed to load books data:', e.message);
            return c.text(e.message, 500);
        }
    });

    // GET /books/:id
    app.get('/:id', async (c: AppContext) => {
        const env = c.get('env');
        const cache = c.get('cache');
        const id = c.req.param('id');

        try {
            const books = await profileAsync(c, 'books_load', () => loadFullBooksData(env, cache));
            const book = books.find(b => b.id === id);
            if (!book) return c.text('Not found', 404);
            return c.json(book);
        } catch (e: any) {
            console.error('Failed to load books data:', e.message);
            return c.text(e.message, 500);
        }
    });

    // DELETE /books/cache ?? ???????????????????????
    app.delete('/cache', async (c: AppContext) => {
        if (!c.get('admin')) return c.text('Permission denied', 403);
        await c.get('cache').delete(CACHE_KEY);
        return c.text('Cleared');
    });

    return app;
}