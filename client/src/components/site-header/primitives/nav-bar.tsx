import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";

export function NavBar({
  menu,
  onClick,
  itemClassName = "",
}: {
  menu: boolean;
  onClick?: () => void;
  itemClassName?: string;
}) {
  const [location] = useLocation();
  const { t } = useTranslation();

  return (
    <>
      <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("article.title")} selected={location === "/" || location.startsWith("/feed")} href="/" />
      {/* <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("timeline")} selected={location === "/timeline"} href="/timeline" /> */}
      {/* <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("moments.title")} selected={location === "/moments"} href="/moments" /> */}
      <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("archive")} selected={location === "/archive" || location === "/timeline" || location === "/hashtags"} href="/archive" />
      <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("books.title")} selected={location.startsWith("/books")} href="/books" />
      {/* <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("hashtags")} selected={location === "/hashtags"} href="/hashtags" /> */}
      <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("photography")} selected={false} href="https://himikouchuu.com/" external />
      <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("friends.title")} selected={location === "/friends"} href="/friends" />
      <NavItem menu={menu} onClick={onClick} itemClassName={itemClassName} title={t("about.title")} selected={location === "/about"} href="/about" />
    </>
  );
}

function NavItem({
  menu, title, selected, href, when = true, onClick, itemClassName = "", external = false,
}: {
  title: string; selected: boolean; href: string; menu?: boolean; when?: boolean;
  onClick?: () => void; itemClassName?: string; external?: boolean;
}) {
  if (!when) return null;

  const className = `${menu ? "" : "hidden"} md:block cursor-pointer hover:text-theme duration-300 px-2 py-4 md:p-4 text-sm ${selected ? "text-theme" : "dark:text-white"} ${itemClassName}`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>
        {title}
      </a>
    );
  }

  return (
    <Link href={href} className={className} state={{ animate: true }} onClick={onClick}>
      {title}
    </Link>
  );
}