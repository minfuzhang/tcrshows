from __future__ import annotations

import html
import json
import os
import re
import secrets
import mimetypes
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

import openpyxl


ROOT = Path(__file__).resolve().parent
DEFAULT_DATA_FILE = ROOT / "data" / "site-data.js"
DATA_FILE = ROOT / "storage" / "site-data.js"
PUBLIC_DATA_FILES = {
    "meta": ROOT / "data" / "site-meta.js",
    "db": ROOT / "data" / "site-db.js",
    "articles": ROOT / "data" / "site-articles.js",
    "services": ROOT / "data" / "site-services.js",
}
EXCEL_FILE = ROOT / "data" / "TCRshows-db.xlsx"
UPLOAD_DIR = ROOT / "assets" / "uploads"
PREFIX = "window.TCRSHOWS_DEFAULT_DATA = "
DB_FIELDS = [
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
]
ADMIN_USERNAME = os.environ.get("TCRSHOWS_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("TCRSHOWS_ADMIN_PASSWORD", "TCRshows2026!")
GITHUB_TOKEN = os.environ.get("TCRSHOWS_GITHUB_TOKEN", "").strip()
GITHUB_REPO = os.environ.get("TCRSHOWS_GITHUB_REPO", "minfuzhang/tcrshows").strip()
GITHUB_BRANCH = os.environ.get("TCRSHOWS_GITHUB_BRANCH", "main").strip()
GITHUB_DATA_PATH = os.environ.get("TCRSHOWS_GITHUB_DATA_PATH", "data/site-data.js").strip()
GITHUB_INDEX_PATH = os.environ.get("TCRSHOWS_GITHUB_INDEX_PATH", "index.html").strip()
GITHUB_PUBLIC_DATA_PATHS = {
    "meta": "data/site-meta.js",
    "db": "data/site-db.js",
    "articles": "data/site-articles.js",
    "services": "data/site-services.js",
}
SESSION_COOKIE = "tcrshows_admin_session"
SESSION_TTL_SECONDS = 8 * 60 * 60
SESSIONS: dict[str, float] = {}


def read_payload() -> dict:
    source_file = DATA_FILE if DATA_FILE.exists() else DEFAULT_DATA_FILE
    text = source_file.read_text(encoding="utf-8").strip()
    if text.startswith(PREFIX):
        text = text[len(PREFIX) :]
    if text.endswith(";"):
        text = text[:-1]
    return json.loads(text)


def serialize_payload(payload: dict) -> str:
    return PREFIX + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"


def serialize_js_var(variable_name: str, value) -> str:
    return f"window.{variable_name} = " + json.dumps(value, ensure_ascii=False, indent=2) + ";\n"


def build_public_payloads(payload: dict) -> dict[str, str]:
    return {
        "meta": serialize_js_var(
            "TCRSHOWS_META",
            {
                "dbTotal": len(payload.get("dbRows", [])),
                "articleTotal": len(payload.get("articles", [])),
                "serviceTotal": len(payload.get("services", [])),
                "coreTotal": 4,
            },
        ),
        "db": serialize_js_var("TCRSHOWS_DB_ROWS", payload.get("dbRows", [])),
        "articles": serialize_js_var("TCRSHOWS_ARTICLES", payload.get("articles", [])),
        "services": serialize_js_var("TCRSHOWS_SERVICES", payload.get("services", [])),
    }


def write_public_payloads(payload: dict) -> dict[str, str]:
    public_payloads = build_public_payloads(payload)
    for key, content in public_payloads.items():
        PUBLIC_DATA_FILES[key].write_text(content, encoding="utf-8")
    return public_payloads


def replace_metric(page: str, attribute: str, value: int) -> str:
    pattern = rf"(<(?:span|strong)\b[^>]*\b{re.escape(attribute)}\b[^>]*>)[^<]*(</(?:span|strong)>)"
    return re.sub(pattern, rf"\g<1>{value}\2", page, count=1)


def apply_site_metrics_to_index(page: str, payload: dict) -> str:
    metrics = {
        "data-db-total": len(payload.get("dbRows", [])),
        "data-article-total": len(payload.get("articles", [])),
        "data-service-total": len(payload.get("services", [])),
    }
    for attribute, value in metrics.items():
        page = replace_metric(page, attribute, value)
    return page


def github_request(method: str, url: str, payload: dict | None = None) -> dict:
    if not GITHUB_TOKEN:
        raise RuntimeError("Render 未配置 TCRSHOWS_GITHUB_TOKEN，内容无法持久保存到 GitHub")

    data = None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "tcrshows-admin",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub 保存失败：{exc.code} {detail}") from exc


def create_github_blob(api_root: str, content: str) -> str:
    blob = github_request(
        "POST",
        f"{api_root}/git/blobs",
        {"content": content, "encoding": "utf-8"},
    )
    return blob["sha"]


def persist_payload_to_github(serialized_payload: str, payload: dict) -> None:
    api_root = f"https://api.github.com/repos/{GITHUB_REPO}"
    branch_ref = quote(f"heads/{GITHUB_BRANCH}", safe="/")
    ref = github_request("GET", f"{api_root}/git/ref/{branch_ref}")
    parent_sha = ref["object"]["sha"]
    parent_commit = github_request("GET", f"{api_root}/git/commits/{parent_sha}")
    base_tree_sha = parent_commit["tree"]["sha"]

    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    index_html = apply_site_metrics_to_index(index_html, payload)
    public_payloads = build_public_payloads(payload)
    data_blob_sha = create_github_blob(api_root, serialized_payload)
    index_blob_sha = create_github_blob(api_root, index_html)
    public_blob_shas = {
        key: create_github_blob(api_root, content)
        for key, content in public_payloads.items()
    }
    tree_items = [
        {
            "path": GITHUB_DATA_PATH,
            "mode": "100644",
            "type": "blob",
            "sha": data_blob_sha,
        },
        {
            "path": GITHUB_INDEX_PATH,
            "mode": "100644",
            "type": "blob",
            "sha": index_blob_sha,
        },
    ]
    tree_items.extend(
        {
            "path": GITHUB_PUBLIC_DATA_PATHS[key],
            "mode": "100644",
            "type": "blob",
            "sha": blob_sha,
        }
        for key, blob_sha in public_blob_shas.items()
    )

    tree = github_request(
        "POST",
        f"{api_root}/git/trees",
        {
            "base_tree": base_tree_sha,
            "tree": tree_items,
        },
    )
    commit = github_request(
        "POST",
        f"{api_root}/git/commits",
        {
            "message": "Update TCRshows site data from admin",
            "tree": tree["sha"],
            "parents": [parent_sha],
            "committer": {
                "name": "TCRshows Admin",
                "email": "tcrshows-admin@users.noreply.github.com",
            },
        },
    )
    github_request(
        "PATCH",
        f"{api_root}/git/refs/{branch_ref}",
        {"sha": commit["sha"], "force": False},
    )


def write_payload(payload: dict) -> None:
    serialized_payload = serialize_payload(payload)
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(serialized_payload, encoding="utf-8")
    write_public_payloads(payload)
    persist_payload_to_github(serialized_payload, payload)


def convert_excel(path: Path) -> tuple[list[str], list[dict]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    columns = [str(value).strip() for value in rows[0]]
    db_rows = []
    for row in rows[1:]:
        item = {}
        for field, value in zip(DB_FIELDS, row):
            item[field] = "" if value is None else str(value).strip()
        db_rows.append(item)
    return columns, db_rows


def extract_multipart_file(body: bytes, content_type: str) -> bytes:
    marker = "boundary="
    if marker not in content_type:
        raise ValueError("Missing multipart boundary")

    boundary = ("--" + content_type.split(marker, 1)[1]).encode()
    for part in body.split(boundary):
        if b"filename=" not in part:
            continue
        header_end = part.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        content = part[header_end + 4 :]
        return content.strip(b"\r\n-")
    raise ValueError("No uploaded file found")


def extract_multipart_upload(body: bytes, content_type: str) -> tuple[str, bytes]:
    marker = "boundary="
    if marker not in content_type:
        raise ValueError("Missing multipart boundary")

    boundary = ("--" + content_type.split(marker, 1)[1]).encode()
    for part in body.split(boundary):
        if b"filename=" not in part:
            continue
        header_end = part.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        header = part[:header_end].decode("utf-8", errors="ignore")
        filename = "upload"
        filename_match = re.search(r'filename="([^"\r\n]+)"|filename=([^;\r\n]+)', header)
        if filename_match:
            filename = Path(
                (filename_match.group(1) or filename_match.group(2) or filename).strip(),
            ).name
        content = part[header_end + 4 :].strip(b"\r\n-")
        return filename, content
    raise ValueError("No uploaded file found")


def save_uploaded_image(filename: str, content: bytes) -> str:
    extension = Path(filename).suffix.lower()
    allowed = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    if extension not in allowed:
        guessed = mimetypes.guess_extension(mimetypes.guess_type(filename)[0] or "")
        extension = guessed if guessed in allowed else ""
    if extension not in allowed:
        raise ValueError("Only jpg, png, webp, and gif images are allowed")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    output_name = f"service-{int(time.time())}-{secrets.token_hex(6)}{extension}"
    output_path = UPLOAD_DIR / output_name
    output_path.write_bytes(content)
    return f"assets/uploads/{output_name}"


def purge_sessions() -> None:
    now = time.time()
    for token, expires_at in list(SESSIONS.items()):
        if expires_at <= now:
            SESSIONS.pop(token, None)


def get_cookie_token(cookie_header: str | None) -> str:
    if not cookie_header:
        return ""

    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return ""

    morsel = cookie.get(SESSION_COOKIE)
    return morsel.value if morsel else ""


def is_authenticated(handler: SimpleHTTPRequestHandler) -> bool:
    purge_sessions()
    token = get_cookie_token(handler.headers.get("Cookie"))
    return bool(token and token in SESSIONS)


def make_session_cookie(token: str, max_age: int) -> str:
    return (
        f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Strict; Max-Age={max_age}"
    )


def render_login_page(error_message: str = "") -> bytes:
    error_html = ""
    if error_message:
        error_html = f'<p class="login-error" role="alert">{html.escape(error_message)}</p>'

    page = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TCRshows | 后台登录</title>
    <link rel="icon" href="/assets/tcrshows-logo-circle.png" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="login-page">
    <main class="login-shell">
      <section class="login-card" aria-labelledby="login-title">
        <a class="login-brand" href="/index.html" aria-label="返回 TCRshows 首页">
          <span class="login-logo-frame">
            <img class="login-logo" src="/assets/tcrshows-logo.png" alt="TCRshows" />
          </span>
          <span>
            <strong>TCRshows</strong>
            <small>后台管理登录</small>
          </span>
        </a>
        <h1 id="login-title">登录后台</h1>
        <p>请输入管理员账号和密码后继续。</p>
        {error_html}
        <form class="login-form" method="post" action="/api/auth/login">
          <label>
            <span>用户名</span>
            <input name="username" autocomplete="username" required />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <button class="button primary" type="submit">登录</button>
        </form>
      </section>
    </main>
  </body>
</html>
"""
    return page.encode("utf-8")


def render_index_page() -> bytes:
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    page = apply_site_metrics_to_index(page, read_payload())
    return page.encode("utf-8")


class TCRshowsHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        route = urlsplit(self.path).path

        if route in {"/", "/index.html"}:
            body = render_index_page()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if route == "/api/auth/logout":
            token = get_cookie_token(self.headers.get("Cookie"))
            if token:
                SESSIONS.pop(token, None)
            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Set-Cookie", make_session_cookie("", 0))
            self.send_header("Location", "/admin.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if route == "/admin.html" and not is_authenticated(self):
            body = render_login_page()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if route == "/api/data":
            self.send_json(read_payload())
            return

        if route.startswith("/api/") and route not in {"/api/auth/login", "/api/auth/logout"}:
            if not is_authenticated(self):
                self.send_json({"ok": False, "error": "Unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return

        super().do_GET()

    def do_POST(self) -> None:
        route = urlsplit(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        try:
            if route == "/api/auth/login":
                form = {
                    key: values[0]
                    for key, values in parse_qs(body.decode("utf-8"), keep_blank_values=True).items()
                }
                if (
                    form.get("username") == ADMIN_USERNAME
                    and form.get("password") == ADMIN_PASSWORD
                ):
                    token = secrets.token_urlsafe(32)
                    SESSIONS[token] = time.time() + SESSION_TTL_SECONDS
                    self.send_response(HTTPStatus.SEE_OTHER)
                    self.send_header("Set-Cookie", make_session_cookie(token, SESSION_TTL_SECONDS))
                    self.send_header("Location", "/admin.html")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return

                body_bytes = render_login_page("用户名或密码不正确")
                self.send_response(HTTPStatus.UNAUTHORIZED)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body_bytes)))
                self.end_headers()
                self.wfile.write(body_bytes)
                return

            if route in {"/api/data", "/api/import-db", "/api/upload-image"} and not is_authenticated(self):
                self.send_json({"ok": False, "error": "Unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return

            if route == "/api/data":
                updates = json.loads(body.decode("utf-8"))
                payload = read_payload()
                for key in ("dbRows", "articles", "services"):
                    if key in updates:
                        payload[key] = updates[key]
                write_payload(payload)
                self.send_json({"ok": True})
                return

            if route == "/api/import-db":
                file_bytes = extract_multipart_file(body, self.headers.get("Content-Type", ""))
                EXCEL_FILE.parent.mkdir(exist_ok=True)
                EXCEL_FILE.write_bytes(file_bytes)
                columns, db_rows = convert_excel(EXCEL_FILE)
                payload = read_payload()
                payload["dbColumns"] = columns
                payload["dbRows"] = db_rows
                write_payload(payload)
                self.send_json({"ok": True, "dbRows": db_rows, "count": len(db_rows)})
                return

            if route == "/api/upload-image":
                filename, file_bytes = extract_multipart_upload(
                    body,
                    self.headers.get("Content-Type", ""),
                )
                image_url = save_uploaded_image(filename, file_bytes)
                self.send_json({"ok": True, "url": image_url})
                return

            self.send_error(HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), TCRshowsHandler)
    print(f"TCRshows site running on port {port}")
    print(f"Admin page running on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
