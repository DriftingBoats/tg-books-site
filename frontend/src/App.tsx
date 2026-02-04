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

export default function App() {
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState("");
  const [books, setBooks] = useState<Book[]>([]);
  const [selected, setSelected] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);

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
        if (selected) {
          const next = data.items.find((item) => item.id === selected.id) || null;
          setSelected(next);
        }
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [query, lang]);

  const related = useMemo(() => {
    if (!selected) return [];
    const tagSet = new Set(splitTags(selected.tags));
    return books
      .filter((book) => book.id !== selected.id)
      .map((book) => {
        const tags = splitTags(book.tags);
        const score = tags.reduce((sum, tag) => sum + (tagSet.has(tag) ? 1 : 0), 0);
        const sameAuthor = selected.author && book.author === selected.author ? 2 : 0;
        return { book, score: score + sameAuthor };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((item) => item.book);
  }, [books, selected]);

  const removeSelected = async () => {
    if (!selected) return;
    if (!confirm("Remove this item from TG and the database?")) return;
    setRemoving(true);
    await fetch(`/api/books/${selected.id}?also_tg=true&key=${encodeURIComponent(adminKey)}`, {
      method: "DELETE",
    });
    setSelected(null);
    setRemoving(false);
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
              className={`card ${selected?.id === book.id ? "selected" : ""}`}
              onClick={() => setSelected(book)}
            >
              <div className="card-title">{book.title || book.file_name || "Untitled"}</div>
              <div className="card-meta">
                <span>{book.author || "Unknown"}</span>
                <span>{book.lang?.toUpperCase() || "-"}</span>
                <span>{book.file_name || "Untitled file"}</span>
                <span>{formatSize(book.file_size)}</span>
              </div>
              <div className="card-tags">
                {splitTags(book.tags).slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </article>
          ))}
        </section>

        <aside className="detail">
          {selected ? (
            <div className="detail-inner">
              <div className="detail-header">
                <p className="detail-label">Book dossier</p>
                <h2>{selected.title || selected.file_name || "Untitled"}</h2>
                <p className="detail-author">{selected.author || "Unknown author"}</p>
              <div className="detail-actions">
                <a className="primary" href={`/api/books/${selected.id}/download`}>
                  Download
                </a>
                <span className="pill">{selected.lang?.toUpperCase() || "-"}</span>
              </div>
              {adminMode && (
                <button className="danger" onClick={removeSelected} disabled={removing}>
                  {removing ? "Removing..." : "Remove from TG"}
                </button>
              )}
            </div>

              <div className="detail-grid">
                <div>
                  <p className="detail-key">Tags</p>
                  <div className="tag-cloud">
                    {splitTags(selected.tags).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                    {splitTags(selected.tags).length === 0 && <span className="muted">None</span>}
                  </div>
                </div>
                <div>
                  <p className="detail-key">File info</p>
                  <p className="detail-value">{selected.file_name || "-"}</p>
                  <p className="detail-sub">{formatSize(selected.file_size)} · {selected.mime_type || "-"}</p>
                </div>
                <div>
                  <p className="detail-key">Source</p>
                  <p className="detail-value">{selected.source || "tg"}</p>
                  <p className="detail-sub">Updated {selected.updated_at || "-"}</p>
                </div>
              </div>

              <div className="related">
                <h3>Related picks</h3>
                {related.length === 0 && <p className="muted">No related titles yet.</p>}
                {related.map((book) => (
                  <button key={book.id} onClick={() => setSelected(book)}>
                    <span>{book.title || book.file_name || "Untitled"}</span>
                    <em>{book.author || "Unknown"}</em>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="detail-empty">
              <p>Pick a title to see its dossier, tags, and download options.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
