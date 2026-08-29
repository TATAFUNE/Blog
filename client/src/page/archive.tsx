import { useEffect, useRef, useState } from "react";
import { Helmet } from 'react-helmet';
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { HashTag } from "../components/hashtag";
import { Waiting } from "../components/loading";
import { client } from "../app/runtime";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants";
import { FeedItem } from "./timeline";

type Hashtag = { id: number; name: string; createdAt: Date; updatedAt: Date; feeds: number };
interface FeedItemType { id: number; createdAt: Date; title: string | null }

export function ArchivePage() {
    const { t } = useTranslation();
    const siteConfig = useSiteConfig();

    const [hashtags, setHashtags] = useState<Hashtag[]>();
    const [sortBy, setSortBy] = useState<'latest' | 'popular'>('latest');

    const [feeds, setFeeds] = useState<Partial<Record<number, FeedItemType[]>>>();
    const [length, setLength] = useState(0);

    const ref = useRef(false);

    useEffect(() => {
        if (ref.current) return;
        client.tag.list().then(({ data }) => { if (data) setHashtags(data as any); });
        client.feed.timeline().then(({ data }) => {
            if (data) {
                const arr = Array.isArray(data) ? data : [];
                setLength(arr.length);
                const groups = (Object.groupBy
                    ? Object.groupBy(arr, ({ createdAt }) => new Date(createdAt).getFullYear())
                    : arr.reduce<Record<number, any[]>>((acc, item) => {
                        const key = new Date(item.createdAt).getFullYear();
                        (acc[key] ||= []).push(item);
                        return acc;
                    }, {}));
                setFeeds(groups as any);
            }
        }).catch(err => console.error("fetchFeeds error:", err));
        ref.current = true;
    }, []);

    const sortedHashtags = hashtags
        ?.filter(({ feeds }) => feeds > 0)
        .sort((a, b) => {
            if (sortBy === 'popular') {
                if (b.feeds !== a.feeds) return b.feeds - a.feeds;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

    return (
        <>
            <Helmet>
                <title>{`${t('archive')} - ${siteConfig.name}`}</title>
                <meta property="og:site_name" content={siteName} />
                <meta property="og:title" content={t('archive')} />
                <meta property="og:image" content={siteConfig.avatar} />
                <meta property="og:type" content="article" />
                <meta property="og:url" content={document.URL} />
            </Helmet>
            <Waiting for={hashtags && feeds}>
                <main className="w-full flex flex-col justify-center items-center mb-8 ani-show">

                    {/* ??ÅCç›è„ */}
                    <div className="wauto text-start py-4 text-4xl font-bold">
                        <p className="text-black dark:text-white">{t('hashtags')}</p>
                        <div className="flex flex-row justify-between">
                            <p className="text-sm mt-4 text-neutral-500 font-normal">
                                {t('total_tags', { count: sortedHashtags?.length || 0 })}
                            </p>
                            <div className="flex flex-row items-center space-x-3">
                                <button onClick={() => setSortBy('latest')} className={`text-sm mt-4 text-neutral-500 font-normal transition-colors hover:text-theme ${sortBy === 'latest' ? "text-theme" : ""}`}>
                                    {t('sort_latest')}
                                </button>
                                <span className="text-sm mt-4 text-neutral-300 dark:text-neutral-700 font-normal">|</span>
                                <button onClick={() => setSortBy('popular')} className={`text-sm mt-4 text-neutral-500 font-normal transition-colors hover:text-theme ${sortBy === 'popular' ? "text-theme" : ""}`}>
                                    {t('sort_popular')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="wauto flex flex-col flex-wrap items-start justify-start mt-2">
                        {sortedHashtags?.map((hashtag, index) => (
                            <div key={index} className="flex min-w-0 w-full flex-row">
                                <div className="m-2 flex min-w-0 w-full flex-row items-center space-x-4 rounded-2xl duration-300">
                                    <Link href={`/hashtag/${hashtag.name}`} className="min-w-0 text-base t-primary hover:text-theme text-pretty">
                                        <HashTag name={hashtag.name} />
                                    </Link>
                                    <div className="flex-1" />
                                    <span className="shrink-0 text-sm t-secondary">
                                        {t("article.total_short$count", { count: hashtag.feeds })}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="wauto border-t border-neutral-200 dark:border-neutral-800 my-6" />

                    {/* ???ÅCç›â∫ */}
                    <div className="wauto text-start text-black dark:text-white py-4 text-4xl font-bold">
                        <p>{t('timeline')}</p>
                        <p className="text-sm mt-4 text-neutral-500 font-normal">
                            {t('article.total$count', { count: length })}
                        </p>
                    </div>
                    {feeds && Object.keys(feeds).sort((a, b) => parseInt(b) - parseInt(a)).map(year => (
                        <div key={year} className="wauto flex flex-col justify-center items-start">
                            <h1 className="flex flex-row items-center space-x-2">
                                <span className="text-2xl font-bold t-primary ">{t('year$year', { year })}</span>
                                <span className="text-sm t-secondary">{t('article.total_short$count', { count: feeds[+year]?.length })}</span>
                            </h1>
                            <div className="w-full flex flex-col justify-center items-start my-4">
                                {feeds[+year]?.map(({ id, title, createdAt }) => (
                                    <FeedItem key={id} id={id.toString()} title={title || t('unlisted')} createdAt={new Date(createdAt)} />
                                ))}
                            </div>
                        </div>
                    ))}
                </main>
            </Waiting>
        </>
    );
}