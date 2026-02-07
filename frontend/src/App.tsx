import { useEffect, useMemo, useState } from "react";

type Book = {
  id: number;
  title: string | null;
  author: string | null;
  lang: string | null;
  tags: string | null;
  category: string | null;
  cover: string | null; // external URL override
  cover_file_id: string | null; // Telegram thumbnail file_id (for /cover proxy)
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  source: string | null;
  updated_at: string | null;
};

type BooksResponse = {
  total: number;
  items: Book[];
};

const langTabs = [
  { value: "", label: "ALL" },
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
] as const;

const baseLangOptions = [
  { value: "", label: "Unset" },
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "th", label: "ไทย" },
];

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}

function formatSize(size?: number | null) {
  if (!size) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let idx = 0;
  while (value > 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const text = value.toFixed(1).replace(/\.0$/, "");
  return `${text}${units[idx]}`;
}

function splitTags(tags?: string | null) {
  if (!tags) return [];
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatDate(raw?: string | null) {
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}/${month}/${day}`;
}

type AppConfig = {
  site_name: string;
  header_name: string;
  app_icon: string;
  apple_icon: string;
  logo: string;
  default_cover: string;
};

const defaultConfig: AppConfig = {
  site_name: "GL Library",
  header_name: "GL Library",
  app_icon: "/favicon.ico",
  apple_icon: "/favicon.ico",
  logo: "",
  default_cover: "",
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState("");
  const [category, setCategory] = useState("");
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [knownLangs, setKnownLangs] = useState<string[]>([]);

  const [editing, setEditing] = useState<Book | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    author: "",
    lang: "",
    tags: "",
    category: "",
    source: "",
    cover: "",
  });

  const adminKey = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("key") || "";
  }, []);

  const adminMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("admin") === "1" && adminKey.length > 0;
  }, [adminKey]);

  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const applyIcons = (rel: string, href: string) => {
      if (!href) return;
      let link = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = href;
    };

    const loadConfig = async () => {
      try {
        const res = await fetch("/api/config");
        if (!res.ok) return;
        const data = (await res.json()) as AppConfig;
        const next = { ...defaultConfig, ...data };
        setConfig(next);
        applyIcons("icon", next.app_icon);
        applyIcons("apple-touch-icon", next.apple_icon || next.logo);
      } catch (err) {
        console.error(err);
      }
    };

    loadConfig();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
    document.title = config.site_name;
  }, [theme, config.site_name]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const coverSrc = (book: Book) => {
    if (book.cover) return book.cover;
    if (book.cover_file_id) return `/api/books/${book.id}/cover`;
    return config.default_cover || "";
  };

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (lang) params.set("lang", lang);
      if (category) params.set("category", category);
      params.set("limit", "200");
      const res = await fetch(`/api/books?${params.toString()}`, { signal: controller.signal });
      const data: BooksResponse = await res.json();
      setBooks(data.items);
      setLoading(false);

      // Snapshot categories only when the view is "unfiltered".
      if (!query.trim() && !lang && !category) {
        const uniq = new Set<string>();
        const langSet = new Set<string>();
        for (const b of data.items) {
          const v = (b.category || "").trim();
          if (v) uniq.add(v);
          const lv = (b.lang || "").trim();
          if (lv) langSet.add(lv);
        }
        setKnownCategories(Array.from(uniq).sort((a, b) => a.localeCompare(b)));
        setKnownLangs(Array.from(langSet).sort((a, b) => a.localeCompare(b)));
      }
    };
    run().catch((err) => {
      if (err?.name === "AbortError") return;
      setLoading(false);
      console.error(err);
    });
    return () => controller.abort();
  }, [category, lang, query]);

  const categoryTabs = useMemo(() => {
    if (!category) return knownCategories;
    return knownCategories.includes(category) ? knownCategories : [category, ...knownCategories];
  }, [category, knownCategories]);

  const langOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const opt of baseLangOptions) {
      seen.set(opt.value, opt.label);
    }
    for (const value of knownLangs) {
      if (!seen.has(value)) {
        seen.set(value, value.toUpperCase());
      }
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [knownLangs]);

  const openEdit = (book: Book) => {
    setEditing(book);
    setEditForm({
      title: (book.title && book.title.trim()) || book.file_name || "",
      author: (book.author && book.author.trim()) || "",
      lang: book.lang || "",
      tags: book.tags || "",
      category: book.category || "",
      source: book.source || "",
      cover: book.cover || "",
    });
  };

  const closeEdit = () => {
    setEditing(null);
    setSavingId(null);
  };

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeEdit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  const reloadBooks = async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (lang) params.set("lang", lang);
    if (category) params.set("category", category);
    params.set("limit", "200");
    const res = await fetch(`/api/books?${params.toString()}`);
    const data: BooksResponse = await res.json();
    setBooks(data.items);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingId(editing.id);

    const body = {
      title: editForm.title.trim() ? editForm.title.trim() : null,
      author: editForm.author.trim() ? editForm.author.trim() : null,
      lang: editForm.lang.trim(),
      tags: editForm.tags.trim(),
      category: editForm.category.trim() ? editForm.category.trim() : null,
      source: editForm.source.trim(),
      cover: editForm.cover.trim() ? editForm.cover.trim() : null,
    };

    const res = await fetch(`/api/books/${editing.id}?key=${encodeURIComponent(adminKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      alert(`Save failed (${res.status}): ${text}`);
      setSavingId(null);
      return;
    }

    closeEdit();
    await reloadBooks();
  };

  const removeBook = async (book: Book) => {
    if (!confirm("Remove this item from TG and the database?")) return;
    setRemovingId(book.id);
    await fetch(`/api/books/${book.id}?also_tg=true&key=${encodeURIComponent(adminKey)}`, {
      method: "DELETE",
    });
    setRemovingId(null);
    await reloadBooks();
  };

  return (
    <div className={adminMode ? "app is-admin" : "app"}>
      <header className="topbar">
        <div className="shell topbar-inner">
          <div className="brand">
            {config.logo ? (
              <img className="brand-mark" src={config.logo} alt="logo" />
            ) : (
              <div className="brand-mark" aria-hidden="true" />
            )}
            <div className="brand-title">{config.header_name}</div>
          </div>

          <div className="topbar-secondary">
            <div className="searchbar" role="search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, author, tags..."
                aria-label="Search"
              />
              <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4 4a1 1 0 0 0 1.4-1.4l-4-4A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11Z"
                  fill="currentColor"
                />
              </svg>
            </div>

            <div className="lang-tabs" role="group" aria-label="Language">
              {langTabs.map((tab) => (
                <button
                  key={tab.value}
                  className={lang === tab.value ? "tab is-active" : "tab"}
                  onClick={() => setLang(tab.value)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="topbar-tools">
            <button
              className="icon-btn"
              type="button"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 18a6 6 0 1 1 0-12a6 6 0 0 1 0 12Zm0-16a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 18a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm10-9a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1ZM4 12a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm15.07 7.07a1 1 0 0 1 0 1.41l-.71.71a1 1 0 1 1-1.41-1.41l.71-.71a1 1 0 0 1 1.41 0ZM7.05 7.05a1 1 0 0 1 0 1.41l-.71.71A1 1 0 1 1 4.93 7.76l.71-.71a1 1 0 0 1 1.41 0ZM19.07 4.93a1 1 0 0 1 0 1.41l-.71.71a1 1 0 1 1-1.41-1.41l.71-.71a1 1 0 0 1 1.41 0ZM7.05 16.95a1 1 0 0 1 0 1.41l-.71.71a1 1 0 1 1-1.41-1.41l.71-.71a1 1 0 0 1 1.41 0Z"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21 14.5A7.5 7.5 0 0 1 9.5 3a1 1 0 0 0-1.2 1.2A9.5 9.5 0 1 0 22.2 15.7a1 1 0 0 0-1.2-1.2Z"
                  />
                </svg>
              )}
            </button>

            {adminMode && <div className="admin-badge">Admin</div>}
          </div>
        </div>
      </header>

      <nav className="shell category-row" aria-label="Categories">
        <div className="category-select-wrap">
          <select className="category-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All Category</option>
            {categoryTabs.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <button className={!category ? "cat is-active" : "cat"} onClick={() => setCategory("")} type="button">
          All Category
        </button>
        {categoryTabs.map((value) => (
          <button
            key={value}
            className={category === value ? "cat is-active" : "cat"}
            onClick={() => setCategory(value)}
            type="button"
          >
            {value}
          </button>
        ))}
      </nav>

      <main className="shell content">
        {loading && <div className="empty-state">Loading...</div>}
        {!loading && books.length === 0 && <div className="empty-state">No results.</div>}
        {!loading && books.length > 0 && (
          <section className="book-list" aria-label="Books">
            {books.map((book) => {
              const src = coverSrc(book);
              return (
                <article key={book.id} className={adminMode ? "book-row is-admin" : "book-row"}>
                  <div className="book-cover" aria-hidden="true">
                    {src && (
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                  </div>

                  <div className="book-main">
                    <div className="book-title">
                      <span className="book-title-text">{book.title || book.file_name || "Untitled"}</span>
                    </div>
                    {book.mime_type && (
                      <div className="book-format-row">
                        <span className="book-format">{book.mime_type}</span>
                      </div>
                    )}
                    <div className="book-sub">
                      <span className="muted">by</span> {book.author || "Unknown"}
                    </div>
                    <div className="book-tags">
                      {splitTags(book.tags).slice(0, 6).map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="book-meta">
                      <span>{book.source || "Unknown"}</span>
                      <span className="sep">·</span>
                      <span>{formatDate(book.updated_at)}</span>
                      <span className="sep">·</span>
                      <span>{book.lang ? book.lang.toUpperCase() : "Unknown"}</span>
                      <span className="sep">·</span>
                      <span>{formatSize(book.file_size)}</span>
                    </div>
                  </div>

                  <div className="book-actions">
                    <div className="book-file">{book.file_name || ""}</div>
                    <a className="download-btn" href={`/api/books/${book.id}/download`}>
                      Download
                    </a>
                    {adminMode && (
                      <div className="admin-actions">
                        <button className="btn-edit" onClick={() => openEdit(book)} type="button">
                          Edit
                        </button>
                        <button
                          className="btn-remove"
                          onClick={() => removeBook(book)}
                          disabled={removingId === book.id}
                          type="button"
                        >
                          {removingId === book.id ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>

      {editing && (
        <div className="modal-backdrop" onMouseDown={closeEdit}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">Edit metadata</div>
            <div className="modal-grid">
              <label>
                Title
                <input
                  value={editForm.title}
                  onChange={(e) => setEditForm((s) => ({ ...s, title: e.target.value }))}
                  placeholder="Title"
                />
              </label>
              <label>
                Author
                <input
                  value={editForm.author}
                  onChange={(e) => setEditForm((s) => ({ ...s, author: e.target.value }))}
                  placeholder="Unknown"
                />
              </label>
              <label>
                Lang
                <select value={editForm.lang} onChange={(e) => setEditForm((s) => ({ ...s, lang: e.target.value }))}>
                  {langOptions.map((opt) => (
                    <option key={opt.value || "unset"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tags
                <input
                  value={editForm.tags}
                  onChange={(e) => setEditForm((s) => ({ ...s, tags: e.target.value }))}
                  placeholder="tag1, tag2"
                />
              </label>
              <label>
                Category
                <input
                  value={editForm.category}
                  onChange={(e) => setEditForm((s) => ({ ...s, category: e.target.value }))}
                  placeholder="Optional"
                />
              </label>
              <label>
                Source
                <input
                  value={editForm.source}
                  onChange={(e) => setEditForm((s) => ({ ...s, source: e.target.value }))}
                />
              </label>
              <label className="modal-span">
                Cover URL (optional)
                <input
                  value={editForm.cover}
                  onChange={(e) => setEditForm((s) => ({ ...s, cover: e.target.value }))}
                  placeholder="https://..."
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={closeEdit} disabled={savingId === editing.id}>
                Cancel
              </button>
              <button className="btn-primary" onClick={saveEdit} disabled={savingId === editing.id}>
                {savingId === editing.id ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        className={showTop ? "back-top is-visible" : "back-top"}
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        title="Back to top"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 5.5 6.5 11a1 1 0 1 0 1.4 1.4l3.1-3.1V19a1 1 0 1 0 2 0V9.3l3.1 3.1a1 1 0 0 0 1.4-1.4L12 5.5Z"
          />
        </svg>
      </button>
    </div>
  );
}
