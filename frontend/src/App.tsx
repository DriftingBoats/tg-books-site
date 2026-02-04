import { useEffect, useMemo, useState } from "react";

type Book = {
  id: number;
  title: string | null;
  author: string | null;
  lang: string | null;
  tags: string | null;
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

const langOptions = [
  { value: "", label: "All" },
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

function formatSize(size?: number | null) {
  if (!size) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let idx = 0;
  while (value > 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(1)} ${units[idx]}`;
}

function splitTags(tags?: string | null) {
  if (!tags) return [];
  return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function formatDate(raw?: string | null) {
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

export default function App() {
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState("");
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const adminKey = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("key") || "";
  }, []);

  const adminMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("admin") === "1" && adminKey.length > 0;
  }, [adminKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (lang) params.set("lang", lang);
      params.set("limit", "200");
      const res = await fetch(`/api/books?${params.toString()}`);
      const data: BooksResponse = await res.json();
      if (!cancelled) {
        setBooks(data.items);
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [query, lang]);

  const removeBook = async (book: Book) => {
    if (!confirm("Remove this item from TG and the database?")) return;
    setRemovingId(book.id);
    await fetch(`/api/books/${book.id}?also_tg=true&key=${encodeURIComponent(adminKey)}`, {
      method: "DELETE",
    });
    setRemovingId(null);
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (lang) params.set("lang", lang);
    params.set("limit", "200");
    const res = await fetch(`/api/books?${params.toString()}`);
    const data: BooksResponse = await res.json();
    setBooks(data.items);
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">ThaiGL Library</p>
          <h1>Thai GL collection with fast search, clean metadata, and calm reading rooms.</h1>
        </div>
          <div className="hero-panel">
            <div className="search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, author, tags"
              />
              <select value={lang} onChange={(event) => setLang(event.target.value)}>
                {langOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {adminMode && <p className="admin-pill">Admin mode</p>}
            <div className="hero-stats">
              <div>
                <p className="stat-value">{books.length}</p>
                <p className="stat-label">Visible titles</p>
              </div>
            <div>
              <p className="stat-value">{lang ? lang.toUpperCase() : "ALL"}</p>
              <p className="stat-label">Language</p>
            </div>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="grid">
          {loading && <div className="loading">Loading library...</div>}
          {!loading && books.length === 0 && <div className="empty">No titles found.</div>}
          {books.map((book) => (
            <article
              key={book.id}
              className="card"
            >
              <div className="card-title">{book.title || book.file_name || "Untitled"}</div>
              <div className="card-subtitle">
                <span>{book.author || "Unknown"}</span>
                <span className="divider">·</span>
                <span>{book.source || "tg"}</span>
              </div>
              <div className="card-meta">
                <span>{book.lang?.toUpperCase() || "-"}</span>
                <span>{formatSize(book.file_size)}</span>
                <span>{formatDate(book.updated_at)}</span>
              </div>
              <div className="card-file">{book.file_name || "Untitled file"}</div>
              <div className="card-tags">
                {splitTags(book.tags).slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
                {splitTags(book.tags).length > 3 && <span>+{splitTags(book.tags).length - 3}</span>}
              </div>
              <div className="card-actions">
                <a className="download" href={`/api/books/${book.id}/download`}>
                  Download
                </a>
                <span>{book.mime_type || "-"}</span>
                {adminMode && (
                  <button
                    className="remove"
                    onClick={() => removeBook(book)}
                    disabled={removingId === book.id}
                  >
                    {removingId === book.id ? "Removing..." : "Remove"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
