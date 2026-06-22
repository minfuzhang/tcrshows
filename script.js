const STORAGE_KEYS = {
  dbRows: "tcrshows.dbRows",
  articles: "tcrshows.articles",
  services: "tcrshows.services",
};

const DB_FIELDS = [
  "id",
  "hla",
  "peptide",
  "pos",
  "antigen",
  "cdr3a",
  "cdr3b",
  "trav",
  "traj",
  "trbv",
  "trbj",
  "functionalValidation",
  "aka",
  "reference",
  "year",
];

const defaultData = window.TCRSHOWS_DEFAULT_DATA || {
  dbRows: [],
  articles: [],
  services: [],
};

let dbRows = readStore(STORAGE_KEYS.dbRows, defaultData.dbRows);
let articles = readStore(STORAGE_KEYS.articles, defaultData.articles);
let services = readStore(STORAGE_KEYS.services, defaultData.services);
let activeArticleFilter = "all";
let activeServiceFilter = "all";

const resultBody = document.querySelector("[data-result-body]");
const resultCount = document.querySelector("[data-result-count]");
const resultsCard = document.querySelector("[data-results-card]");
const articleList = document.querySelector("[data-article-list]");
const serviceList = document.querySelector("[data-service-list]");
const dbForm = document.querySelector("[data-db-form]");
const searchForm = document.querySelector("[data-search-form]");
const scrollTopLink = document.querySelector("[data-scroll-top]");

function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function loadServerData() {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  try {
    const response = await fetch(`/api/data?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    dbRows = Array.isArray(payload.dbRows) ? payload.dbRows : dbRows;
    articles = Array.isArray(payload.articles) ? payload.articles : articles;
    services = Array.isArray(payload.services) ? payload.services : services;
    saveStore(STORAGE_KEYS.dbRows, dbRows);
    saveStore(STORAGE_KEYS.articles, articles);
    saveStore(STORAGE_KEYS.services, services);
    renderAll();
  } catch {
    // Keep bundled data available when the server cannot be reached.
  }
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(value) {
  const url = String(value || "#").trim();
  if (!url) return "#";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("#")) {
    return url;
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) return "#";
  return url.replaceAll('"', "%22");
}

function metricValue(selector, value, suffix = "") {
  document.querySelectorAll(selector).forEach((node) => {
    node.textContent = `${value}${suffix}`;
  });
}

function renderMetrics() {
  metricValue("[data-db-total]", dbRows.length);
  metricValue("[data-article-total]", articles.length);
  metricValue("[data-service-total]", services.length);
}

function renderResults(rows) {
  if (!resultsCard || !resultBody || !resultCount) return;
  resultsCard.hidden = false;
  resultBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          ${DB_FIELDS.map((field) => `<td>${escapeHtml(row[field])}</td>`).join("")}
        </tr>
      `,
    )
    .join("");
  resultCount.textContent = `${rows.length} 条匹配`;
}

function levelStars(level) {
  if (String(level || "").includes("重要")) return "★★★";
  if (String(level || "").includes("推荐")) return "★★☆";
  return "☆☆☆";
}

function renderArticles(filter = activeArticleFilter) {
  if (!articleList) return;
  const visible = filter === "all" ? articles : articles.filter((item) => item.category === filter);
  articleList.innerHTML = visible
    .map((item) => {
      const url = safeUrl(item.url);
      const target = url.startsWith("http") ? ' target="_blank" rel="noopener"' : "";
      return `
        <article class="article-card page-card">
          <div class="card-kicker">
            <span class="tag">${escapeHtml(item.category)}</span>
            <span class="stars" aria-label="${escapeHtml(item.level || "一般")}">${levelStars(item.level)}</span>
          </div>
          <h3>
            <a class="title-link" href="${escapeHtml(url)}"${target}>${escapeHtml(item.title)}</a>
          </h3>
          ${item.summary ? `<p class="card-summary">${escapeHtml(item.summary)}</p>` : ""}
          <div class="card-meta">
            <span>${escapeHtml(item.author || "TCRshows")}</span>
            <time datetime="${escapeHtml(String(item.date || "").slice(0, 10))}">${escapeHtml(item.date || "")}</time>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderServices(filter = activeServiceFilter) {
  if (!serviceList) return;
  const visible = filter === "all" ? services : services.filter((item) => item.category === filter);
  serviceList.innerHTML = visible
    .map((item) => {
      const url = safeUrl(item.url);
      const target = url.startsWith("http") ? ' target="_blank" rel="noopener"' : "";
      const imageMarkup = item.image
        ? `<img class="service-upload-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}缩略图" />`
        : "";
      return `
        <article class="service-card page-card">
          ${imageMarkup ? `<div class="service-thumb">${imageMarkup}</div>` : ""}
          <div class="service-content">
            <span class="tag service-tag">${escapeHtml(item.category)}</span>
            <h3><a class="title-link" href="${escapeHtml(url)}"${target}>${escapeHtml(item.title)}</a></h3>
            <p>${escapeHtml(item.text || "")}</p>
            <div class="card-meta">
              <span>${escapeHtml(item.author || "TCRshows")}</span>
              <time datetime="${escapeHtml(String(item.date || "").slice(0, 10))}">${escapeHtml(item.date || "")}</time>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function setActive(selector, value) {
  document.querySelectorAll(selector).forEach((button) => {
    const dataValue = button.dataset.articleFilter || button.dataset.serviceFilter;
    button.classList.toggle("active", dataValue === value);
  });
}

function initDatabaseForm() {
  if (!dbForm) return;
  dbForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const filters = Object.fromEntries(
      [...form.entries()].map(([key, value]) => [key, normalize(value)]),
    );

    const filtered = dbRows.filter((row) =>
      Object.entries(filters).every(([key, value]) => {
        if (!value) return true;
        return normalize(row[key]).includes(value);
      }),
    );

    renderResults(filtered);
  });

  dbForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      if (resultsCard) resultsCard.hidden = true;
      if (resultBody) resultBody.innerHTML = "";
      if (resultCount) resultCount.textContent = "0 条匹配";
    }, 0);
  });
}

function initSearchForm() {
  if (!searchForm) return;
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = normalize(new FormData(event.currentTarget).get("q"));
    if (!query) return;

    const matchedArticle = articles.find((item) =>
      [item.title, item.category, item.summary].some((value) => normalize(value).includes(query)),
    );
    window.location.href = matchedArticle ? "learning.html" : "database.html";
  });
}

function initFilters() {
  document.querySelectorAll("[data-article-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeArticleFilter = button.dataset.articleFilter;
      setActive("[data-article-filter]", activeArticleFilter);
      renderArticles(activeArticleFilter);
    });
  });

  document.querySelectorAll("[data-service-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeServiceFilter = button.dataset.serviceFilter;
      setActive("[data-service-filter]", activeServiceFilter);
      renderServices(activeServiceFilter);
    });
  });
}

function initScrollTop() {
  if (!scrollTopLink) return;
  scrollTopLink.addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function renderAll() {
  renderMetrics();
  renderArticles(activeArticleFilter);
  renderServices(activeServiceFilter);
}

initDatabaseForm();
initSearchForm();
initFilters();
initScrollTop();
renderAll();
loadServerData();
