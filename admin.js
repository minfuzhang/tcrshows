const STORAGE_KEYS = {
  dbRows: "tcrshows.dbRows",
  articles: "tcrshows.articles",
  services: "tcrshows.services",
};

const defaultData = window.TCRSHOWS_DEFAULT_DATA || {
  dbRows: [],
  articles: [],
  services: [],
};
const hasServerBackend = location.protocol === "http:" || location.protocol === "https:";

let dbRows = readStore(STORAGE_KEYS.dbRows, defaultData.dbRows);
let articles = readStore(STORAGE_KEYS.articles, defaultData.articles);
let services = readStore(STORAGE_KEYS.services, defaultData.services);

const dbJson = document.querySelector("[data-db-json]");
const articleForm = document.querySelector("[data-article-form]");
const serviceForm = document.querySelector("[data-service-form]");
const serviceImageFile = document.querySelector("[data-service-image-file]");
const uploadServiceImage = document.querySelector("[data-upload-service-image]");

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

async function persistAll() {
  saveStore(STORAGE_KEYS.dbRows, dbRows);
  saveStore(STORAGE_KEYS.articles, articles);
  saveStore(STORAGE_KEYS.services, services);

  if (!hasServerBackend) return;

  const response = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dbRows, articles, services }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "后台文件写入失败");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fillForm(form, item, index) {
  form.reset();
  Object.entries(item || {}).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  });
  form.elements.index.value = index ?? "";
}

function fillServiceImage(imageUrl = "") {
  if (serviceForm.elements.image) {
    serviceForm.elements.image.value = imageUrl;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("图片读取失败")));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("图片加载失败")));
    image.src = src;
  });
}

async function fileToServiceImage(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }

  const sourceUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceUrl);
  const maxSize = 720;
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.86);
}
function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderDb() {
  dbJson.value = JSON.stringify(dbRows, null, 2);
  document.querySelector("[data-db-count]").textContent = `${dbRows.length} 条记录`;
}

function renderArticleList(activeIndex = 0) {
  document.querySelector("[data-article-count]").textContent = `${articles.length} 条内容`;
  document.querySelector("[data-article-list-admin]").innerHTML = articles
    .map(
      (item, index) => `
        <button class="${index === activeIndex ? "active" : ""}" type="button" data-edit-article="${index}">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.category)} · ${escapeHtml(item.author)} · ${escapeHtml(item.date)}</span>
        </button>
      `,
    )
    .join("");
  fillForm(articleForm, articles[activeIndex] || {}, articles.length ? activeIndex : "");
}

function renderServiceList(activeIndex = 0) {
  document.querySelector("[data-service-count]").textContent = `${services.length} 条内容`;
  document.querySelector("[data-service-list-admin]").innerHTML = services
    .map(
      (item, index) => `
        <button class="${index === activeIndex ? "active" : ""}" type="button" data-edit-service="${index}">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.category)} · ${escapeHtml(item.author)} · ${escapeHtml(item.date)}</span>
        </button>
      `,
    )
    .join("");
  fillForm(serviceForm, services[activeIndex] || {}, services.length ? activeIndex : "");
}

document.querySelector("[data-save-db]").addEventListener("click", async () => {
  try {
    const nextRows = JSON.parse(dbJson.value);
    if (!Array.isArray(nextRows)) throw new Error("数据库数据必须是数组");
    dbRows = nextRows;
    await persistAll();
    renderDb();
    alert(hasServerBackend ? "数据库已写入后台文件。" : "数据库已保存，刷新前台页面后生效。");
  } catch (error) {
    alert(`保存失败：${error.message}`);
  }
});

document.querySelector("[data-load-default-db]").addEventListener("click", async () => {
  dbRows = defaultData.dbRows;
  await persistAll();
  renderDb();
  alert("已载入 TCRshows-db.xlsx 转换的默认数据。");
});

document.querySelector("[data-export-db]").addEventListener("click", () => {
  downloadJson("tcrshows-db.json", dbRows);
});

document.querySelector("[data-upload-xlsx]").addEventListener("click", async () => {
  const file = document.querySelector("[data-db-xlsx]").files[0];
  if (!file) {
    alert("请先选择 .xlsx 文件。");
    return;
  }
  if (!hasServerBackend) {
    alert("当前是直接打开HTML的静态模式。要上传Excel写回文件，请运行 python server.py 后从 localhost 打开后台。");
    return;
  }

  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/import-db", { method: "POST", body: form });
  if (!response.ok) {
    alert("上传失败，请检查Excel格式。");
    return;
  }
  const payload = await response.json();
  dbRows = payload.dbRows;
  await persistAll();
  renderDb();
  alert(`已导入 ${dbRows.length} 条数据库记录。`);
});

document.querySelector("[data-article-list-admin]").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-article]");
  if (!button) return;
  renderArticleList(Number(button.dataset.editArticle));
});

articleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = formToObject(articleForm);
  const index = item.index === "" ? articles.length : Number(item.index);
  delete item.index;
  articles[index] = item;
  await persistAll();
  renderArticleList(index);
  alert("精选学习内容已保存。");
});

document.querySelector("[data-new-article]").addEventListener("click", () => {
  fillForm(
    articleForm,
    {
      title: "",
      category: "TCR-T",
      author: "TCRshows",
      date: "",
      level: "一般",
      url: "#",
      summary: "",
    },
    "",
  );
});

document.querySelector("[data-delete-article]").addEventListener("click", () => {
  const index = articleForm.elements.index.value;
  if (index === "") return;
  articles.splice(Number(index), 1);
  persistAll();
  renderArticleList(0);
});

document.querySelector("[data-service-list-admin]").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-service]");
  if (!button) return;
  renderServiceList(Number(button.dataset.editService));
});

serviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = formToObject(serviceForm);
  const index = item.index === "" ? services.length : Number(item.index);
  delete item.index;
  services[index] = item;
  await persistAll();
  renderServiceList(index);
  alert("产品服务内容已保存。");
});

document.querySelector("[data-new-service]").addEventListener("click", () => {
  fillForm(
    serviceForm,
    {
      title: "",
      category: "TCR-T",
      author: "TCRshows",
      date: "",
      url: "#",
      art: "cell-art",
      image: "",
      text: "",
    },
    "",
  );
});

uploadServiceImage.addEventListener("click", async () => {
  const file = serviceImageFile.files[0];
  if (!file) {
    alert("请选择一张图片。");
    return;
  }

  try {
    uploadServiceImage.disabled = true;
    uploadServiceImage.textContent = "处理中...";
    const imageDataUrl = await fileToServiceImage(file);
    fillServiceImage(imageDataUrl);
    alert("缩略图已生成并填入表单，保存后前台即可显示。");
  } catch (error) {
    alert(`图片处理失败：${error.message}`);
  } finally {
    uploadServiceImage.disabled = false;
    uploadServiceImage.textContent = "上传并使用此图片";
  }
});

document.querySelector("[data-delete-service]").addEventListener("click", () => {
  const index = serviceForm.elements.index.value;
  if (index === "") return;
  services.splice(Number(index), 1);
  persistAll();
  renderServiceList(0);
});

renderDb();
renderArticleList();
renderServiceList();
