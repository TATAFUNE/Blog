import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import type { BookDetail } from "@rin/api";
import { client } from "../app/runtime";
import { useApiResource } from "../hooks/use-api-resource";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Waiting } from "../components/loading";
import { siteName } from "../utils/constants";
import { ErrorPage } from "./error";

export function BookDetailPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const { data: book, loading, error } = useApiResource<BookDetail>(() => client.books.get(id));

  if (!loading && error) {
    return <ErrorPage error={error} />;
  }

  return (
    <>
      <Helmet>
        <title>{`${book?.title || t("books.title")} - ${siteConfig.name}`}</title>
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={book?.title || ""} />
        <meta property="og:image" content={book?.cover} />
      </Helmet>
      <Waiting for={!loading && !!book}>
        {book && (
          <main className="wauto flex flex-col mb-8 t-primary ani-show">
            <div className="flex flex-row gap-4 py-4">
              <ImageWithFallback
                className="w-28 aspect-[3/4] rounded-lg object-cover flex-shrink-0"
                src={book.cover}
                alt={book.title}
              />
              <div className="flex flex-col justify-center">
                <a href={book.url} target="_blank" rel="noopener noreferrer" className="text-xl font-bold hover:text-theme">
                  {book.title}
                </a>
                <p className="text-sm text-neutral-500 mt-1">{book.author}</p>
                <p className="text-xs text-neutral-500 mt-1">{[book.press, book.pubdate].filter(Boolean).join(" ? ")}</p>
                {book.rating != null && (
                  <div className="text-theme text-sm mt-2">
                    {"Åö".repeat(book.rating)}
                    <span className="text-neutral-400">{"Åö".repeat(5 - book.rating)}</span>
                  </div>
                )}
              </div>
            </div>

            {book.reviews.length > 0 && (
              <section className="mt-4">
                <h2 className="text-lg font-bold mb-2">{t("books.reviews")}</h2>
                <div className="flex flex-col gap-3">
                  {book.reviews.map((note, i) => (
                    <p key={i} className="text-sm leading-relaxed border-l-2 border-theme pl-3 whitespace-pre-wrap">
                      {note.content}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {book.excerpts.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-bold mb-2">{t("books.excerpts")}</h2>
                <div className="flex flex-col gap-3">
                  {book.excerpts.map((note, i) => (
                    <p key={i} className="text-sm leading-relaxed text-neutral-500 bg-secondary bg-button rounded-lg p-3 whitespace-pre-wrap">
                      {note.content}
                    </p>
                  ))}
                </div>
              </section>
            )}
          </main>
        )}
      </Waiting>
    </>
  );
}