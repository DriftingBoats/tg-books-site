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
  const [category, setCategory] = useState("");
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
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

  const loadBooks = async (opts?: { query?: string; lang?: string; category?: string }) => {
    const q = opts?.query ?? query;
    const l = opts?.lang ?? lang;
    const c = opts?.category ?? category;

    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("query", q.trim());
    if (l) params.set("lang", l);
    if (c) params.set("category", c);
    params.set("limit", "200");
    const res = await fetch(`/api/books?${params.toString()}`);
    const data: BooksResponse = await res.json();
    setBooks(data.items);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (lang) params.set("lang", lang);
      if (category) params.set("category", category);
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
  }, [query, lang, category]);

  const removeBook = async (book: Book) => {
    if (!confirm("Remove this item from TG and the database?")) return;
    setRemovingId(book.id);
    await fetch(`/api/books/${book.id}?also_tg=true&key=${encodeURIComponent(adminKey)}`, {
      method: "DELETE",
    });
    setRemovingId(null);
    await loadBooks();
  };

  const categoryOptions = useMemo(() => {
    const uniq = new Set<string>();
    for (const b of books) {
      const v = (b.category || "").trim();
      if (v) uniq.add(v);
    }
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [books]);

  useEffect(() => {
    // Keep a stable list of categories so you can switch between them even when filtered.
    if (!category) setKnownCategories(categoryOptions);
  }, [category, categoryOptions]);

  const categoryOptionsForSelect = useMemo(() => {
    const base = knownCategories.length ? knownCategories : categoryOptions;
    if (!category) return base;
    return base.includes(category) ? base : [category, ...base];
  }, [category, categoryOptions, knownCategories]);

  const openEdit = (book: Book) => {
    setEditing(book);
    setEditForm({
      title: book.title || "",
      author: book.author || "",
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
    await loadBooks();
  };

  const coverSrc = (book: Book) => {
    if (book.cover) return book.cover;
    if (book.cover_file_id) return `/api/books/${book.id}/cover`;
    return "";
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
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {categoryOptionsForSelect.map((value) => (
                  <option key={value} value={value}>
                    {value}
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
              <div className="card-cover">
                {coverSrc(book) ? (
                  <img
                    src={coverSrc(book)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="card-cover-placeholder" />
                )}
              </div>
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
              {book.category && <div className="card-category">{book.category}</div>}
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
                  <button className="edit" onClick={() => openEdit(book)}>
                    Edit
                  </button>
                )}
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

      {editing && (
        <div className="modal-backdrop" onMouseDown={closeEdit}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">Edit metadata</div>
            <div className="modal-grid">
              <label>
                Title
                <input value={editForm.title} onChange={(e) => setEditForm((s) => ({ ...s, title: e.target.value }))} />
              </label>
              <label>
                Author
                <input
                  value={editForm.author}
                  onChange={(e) => setEditForm((s) => ({ ...s, author: e.target.value }))}
                />
              </label>
              <label>
                Lang
                <input value={editForm.lang} onChange={(e) => setEditForm((s) => ({ ...s, lang: e.target.value }))} />
              </label>
              <label>
                Tags
                <input value={editForm.tags} onChange={(e) => setEditForm((s) => ({ ...s, tags: e.target.value }))} />
              </label>
              <label>
                Category
                <input
                  value={editForm.category}
                  onChange={(e) => setEditForm((s) => ({ ...s, category: e.target.value }))}
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
    </div>
  );
}
