import { useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import type { BookCard, BookListResponse } from "@rin/api";
import { client } from "../app/runtime";
import { useApiResource } from "../hooks/use-api-resource";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Waiting } from "../components/loading";
import { siteName } from "../utils/constants";

type Tab = "read" | "reading" | "want";

export function BooksPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const [tab, setTab] = useState<Tab>("read");
  const { data, loading } = useApiResource<BookListResponse>(() => client.books.list());

  // tab 分类：已读 / 在读 / 想读
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "read", label: t("books.read"), count: data?.counts.read ?? 0 },
    { key: "reading", label: t("books.reading"), count: data?.counts.reading ?? 0 },
    { key: "want", label: t("books.want"), count: data?.counts.want ?? 0 },
  ];

  const list = data ? data[tab] : [];

  return (
    <>
      <Helmet>
        <title>{`${t("books.title")} - ${siteConfig.name}`}</title>
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={t("books.title")} />
      </Helmet>
      <Waiting for={!loading}>
        <main className="w-full flex flex-col items-center mb-8 t-primary ani-show">
          <div className="wauto flex flex-row gap-2 py-4">
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2 rounded-full text-sm transition-colors ${
                  tab === key ? "bg-theme text-white" : "bg-secondary t-primary bg-button"
                }`}
              >
                {label} · {count}
              </button>
            ))}
          </div>

          <p className="wauto text-sm text-neutral-500 pb-2 self-start px-1">
            {t("books.total", { count: list.length })}
          </p>

          <div className="wauto grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
            {list.map((book) => (
              <BookCardItem key={book.id} book={book} />
            ))}
          </div>

          {list.length === 0 && (
            <p className="wauto text-center text-neutral-500 py-8">{t("books.empty")}</p>
          )}
        </main>
      </Waiting>
    </>
  );
}

function BookCardItem({ book }: { book: BookCard }) {
  return (
    <Link href={`/books/${book.id}`} className="flex flex-col items-start">
      <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden bg-secondary">
        <ImageWithFallback className="w-full h-full object-cover" src={book.cover} alt={book.title} />
        {book.dateLabel && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            {book.dateLabel}
          </span>
        )}
      </div>
      <p className="mt-2 w-full truncate text-sm">{book.title}</p>
      {book.rating != null && (
        <div className="text-theme text-xs">
          {"★".repeat(book.rating)}
          <span className="text-neutral-400">{"☆".repeat(5 - book.rating)}</span>
        </div>
      )}
    </Link>
  );
}