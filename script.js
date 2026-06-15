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

const resultBody = document.querySelector("[data-result-body]");
const resultCount = document.querySelector("[data-result-count]");
const resultsCard = document.querySelector("[data-results-card]");
const articleList = document.querySelector("[data-article-list]");
const serviceList = document.querySelector("[data-service-list]");
const therapyTrack = document.querySelector("[data-therapy-track]");
const therapyDots = document.querySelectorAll("[data-therapy-slide]");
const scrollTopLink = document.querySelector("[data-scroll-top]");

function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
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

function renderResults(rows) {
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

function renderArticles(filter = "all") {
  const visible =
    filter === "all" ? articles : articles.filter((item) => item.category === filter);
  articleList.innerHTML = visible
    .map((item) => {
      const url = safeUrl(item.url);
      const target = url.startsWith("http") ? ' target="_blank" rel="noopener"' : "";
      return `
        <article
          class="article-card ${item.level === "重要" ? "important" : "normal"}"
          data-level="${escapeHtml(item.level || "一般")}"
          data-category="${escapeHtml(item.category)}"
        >
          <h3><a class="title-link" href="${escapeHtml(url)}"${target}>${escapeHtml(item.title)}</a></h3>
          <span class="tag">${escapeHtml(item.category)}</span>
          ${item.summary ? `<p class="card-summary">${escapeHtml(item.summary)}</p>` : ""}
          <div class="card-meta">
            <span>${escapeHtml(item.author)}</span>
            <time datetime="${escapeHtml(String(item.date || "").slice(0, 10))}">${escapeHtml(item.date)}</time>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderServices(filter = "TCR-T") {
  const visible = services.filter((item) => item.category === filter);
  serviceList.innerHTML = visible
    .map((item) => {
      const url = safeUrl(item.url);
      const target = url.startsWith("http") ? ' target="_blank" rel="noopener"' : "";
      return `
        <article class="service-card">
          <div class="service-art" aria-hidden="true">
            <span class="${escapeHtml(item.art || "cell-art")}"></span>
          </div>
          <div class="service-content">
            <h3><a class="title-link" href="${escapeHtml(url)}"${target}>${escapeHtml(item.title)}</a></h3>
            <span class="tag">${escapeHtml(item.category)}</span>
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

document.querySelector("[data-db-form]").addEventListener("submit", (event) => {
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

document.querySelector("[data-db-form]").addEventListener("reset", () => {
  window.setTimeout(() => {
    resultsCard.hidden = true;
    resultBody.innerHTML = "";
    resultCount.textContent = "0 条匹配";
  }, 0);
});

document.querySelector("[data-search-form]").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = normalize(new FormData(event.currentTarget).get("q"));
  if (!query) return;

  const matchedArticle = articles.find((item) =>
    [item.title, item.category, item.summary].some((value) => normalize(value).includes(query)),
  );
  if (matchedArticle) {
    renderArticles(matchedArticle.category);
    setActive("[data-article-filter]", matchedArticle.category);
    document.querySelector("#learning").scrollIntoView({ behavior: "smooth" });
    return;
  }

  document.querySelector("#database").scrollIntoView({ behavior: "smooth" });
});

document.querySelectorAll("[data-article-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.articleFilter;
    setActive("[data-article-filter]", filter);
    renderArticles(filter);
  });
});

document.querySelectorAll("[data-service-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.serviceFilter;
    setActive("[data-service-filter]", filter);
    renderServices(filter);
  });
});

if (scrollTopLink) {
  scrollTopLink.addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function setActive(selector, value) {
  document.querySelectorAll(selector).forEach((button) => {
    const dataValue = button.dataset.articleFilter || button.dataset.serviceFilter;
    button.classList.toggle("active", dataValue === value);
  });
}

function initTherapyCarousel() {
  if (!therapyTrack || therapyDots.length === 0) return;

  let activeIndex = 0;

  const showSlide = (index) => {
    activeIndex = (index + therapyDots.length) % therapyDots.length;
    therapyTrack.style.transform = `translateX(-${activeIndex * 100}%)`;
    therapyDots.forEach((button, buttonIndex) => {
      button.classList.toggle("active", buttonIndex === activeIndex);
    });
  };

  let timer = window.setInterval(() => showSlide(activeIndex + 1), 4200);

  therapyDots.forEach((button) => {
    button.addEventListener("click", () => {
      window.clearInterval(timer);
      showSlide(Number(button.dataset.therapySlide || 0));
      timer = window.setInterval(() => showSlide(activeIndex + 1), 4200);
    });
  });
}

initTherapyCarousel();
renderArticles();
renderServices();
