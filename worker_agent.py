"""Restricted remote worker for Ella.

This process is intentionally not Ella: it has no model, memory, voice, or
dashboard. It accepts only authenticated, allowlisted research/file/test jobs.
"""
import hashlib
import html
import hmac
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    from selenium import webdriver
    from selenium.common.exceptions import WebDriverException
    from selenium.webdriver.chrome.options import Options as ChromeOptions
except ImportError:
    webdriver = None
    WebDriverException = Exception
    ChromeOptions = None

try:
    import pyautogui
except ImportError:
    pyautogui = None

WORKER_ID = os.environ.get("ELLA_WORKER_ID", "pi-worker")
TOKEN = os.environ.get("ELLA_WORKER_TOKEN", "")
PORT = int(os.environ.get("ELLA_WORKER_PORT", "8765"))
HOST = os.environ.get("ELLA_WORKER_BIND", "0.0.0.0")
ROOTS = [pathlib.Path(item).resolve() for item in os.environ.get("ELLA_WORKSPACES", "").split(";") if item]
MAX_BODY = 256 * 1024
TOOL_STATUS = {"method": "IDLE", "state": "IDLE", "detail": "No research tool is active.", "updatedAt": None}


def set_tool_status(method, state, detail):
    TOOL_STATUS.update({"method": method, "state": state, "detail": detail, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})


def _validate_url(url):
    parsed = urllib.parse.urlparse(str(url))
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("research URL must be http or https")
    return parsed


def safe_path(value):
    candidate = pathlib.Path(value).resolve()
    if not ROOTS or not any(candidate == root or root in candidate.parents for root in ROOTS):
        raise ValueError("path is outside configured worker workspaces")
    return candidate


class _ReadableHtml(HTMLParser):
    """Small stdlib-only extractor that ignores non-content HTML elements."""

    ignored = {"script", "style", "noscript", "template", "svg", "canvas", "nav", "header", "footer", "form", "aside"}
    blocks = {"br", "p", "div", "li", "article", "section", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "th"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.links = []
        self.depth = 0
        self.title = ""
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        name = tag.lower()
        if name == "a":
            href = dict(attrs).get("href", "")
            if href.startswith(("http://", "https://")):
                self.links.append(href)
        if name in self.ignored:
            self.depth += 1
        if name == "title":
            self.in_title = True
        if name in self.blocks:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        name = tag.lower()
        if name in self.blocks:
            self.parts.append("\n")
        if name == "title":
            self.in_title = False
        if name in self.ignored and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if not self.depth:
            self.parts.append(data)


def extract_html_text(value):
    raw = str(value or "")
    if "<" not in raw or ">" not in raw:
        return re.sub(r"\s+", " ", html.unescape(raw)).strip()
    parser = _ReadableHtml()
    try:
        parser.feed(raw)
        parser.close()
        value = " ".join(line.strip() for line in "\n".join(parser.parts).splitlines() if line.strip())
    except Exception:
        value = re.sub(r"<[^>]*>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def extract_beautifulsoup(value, url):
    if BeautifulSoup is None:
        raise RuntimeError("BeautifulSoup4 is not installed")
    soup = BeautifulSoup(str(value or ""), "html.parser")
    for node in soup(["script", "style", "noscript", "template", "svg", "canvas", "nav", "header", "footer", "form", "aside"]):
        node.decompose()
    title = soup.title.get_text(" ", strip=True) if soup.title else url
    headings = [node.get_text(" ", strip=True) for node in soup.find_all(["h1", "h2", "h3", "h4"]) if node.get_text(" ", strip=True)]
    links = []
    for node in soup.find_all("a", href=True):
        link = urllib.parse.urljoin(url, node["href"])
        if urllib.parse.urlparse(link).scheme in ("http", "https"):
            links.append(link)
    tables = []
    for table in soup.find_all("table")[:10]:
        rows = []
        for row in table.find_all("tr")[:50]:
            rows.append([cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])])
        if rows:
            tables.append(rows)
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()
    return {"title": title[:200] or url, "text": text[:12000], "headings": headings[:30], "links": list(dict.fromkeys(links))[:50], "tables": tables}


def deterministic_claims(text, limit=8):
    cleaned = extract_html_text(text)
    if not cleaned:
        return []
    sentences = [item.strip() for item in re.split(r"(?<=[.!?])\s+", cleaned) if 25 <= len(item.strip()) <= 500]
    if not sentences:
        sentences = [item.strip() for item in re.findall(r".{1,400}(?:\s|$)", cleaned) if len(item.strip()) >= 25]
    seen = set()
    result = []
    for sentence in sentences:
        key = " ".join(sorted(set(re.findall(r"[a-z0-9]{3,}", sentence.lower()))))
        if key and key not in seen:
            seen.add(key)
            result.append(sentence)
    return result[:limit]


def fetch_page_http(url):
    _validate_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "EllaResearchWorker/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        content_type = response.headers.get_content_type().lower()
        if content_type not in ("text/html", "application/xhtml+xml", "text/plain", "application/json"):
            raise ValueError("unsupported source content type")
        content = response.read(512 * 1024).decode("utf-8", "replace")
        parsed = extract_beautifulsoup(content, url)
        parsed.update({"url": url, "method": "HTTP/BeautifulSoup", "claims": deterministic_claims(parsed["text"])})
        return parsed


def fetch_page_selenium(url, timeout=20):
    _validate_url(url)
    if webdriver is None or ChromeOptions is None:
        raise RuntimeError("Selenium is not installed")
    options = ChromeOptions()
    if os.environ.get("ELLA_SELENIUM_HEADLESS", "1").lower() not in ("0", "false", "no"):
        options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    driver = None
    set_tool_status("Selenium", "RUNNING", f"Opening {url}")
    try:
        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(timeout)
        driver.get(url)
        parsed = extract_beautifulsoup(driver.page_source, url)
        parsed.update({"url": url, "method": "Selenium", "claims": deterministic_claims(parsed["text"])})
        return parsed
    except WebDriverException as error:
        raise RuntimeError(f"Selenium could not load source: {error}") from error
    finally:
        if driver is not None:
            driver.quit()


def fetch_page(url):
    set_tool_status("HTTP/BeautifulSoup", "RUNNING", f"Retrieving {url}")
    try:
        page = fetch_page_http(url)
        if len(page["text"]) >= 200 or not webdriver:
            set_tool_status("HTTP/BeautifulSoup", "COMPLETE", f"Extracted {len(page['text'])} characters")
            return page
    except Exception as http_error:
        if not webdriver:
            raise
        page = None
        http_error_text = str(http_error)
    else:
        http_error_text = "HTTP response contained too little readable content"
    try:
        page = fetch_page_selenium(url)
        set_tool_status("Selenium", "COMPLETE", f"Extracted {len(page['text'])} characters")
        return page
    except Exception as selenium_error:
        raise RuntimeError(f"HTTP/BeautifulSoup failed ({http_error_text}); Selenium fallback failed ({selenium_error})") from selenium_error


def run_pyautogui_action(action):
    if pyautogui is None:
        raise RuntimeError("PyAutoGUI is not installed")
    operation = str(action.get("operation", "")).lower()
    set_tool_status("PyAutoGUI", "RUNNING", operation or "GUI action")
    if operation == "screenshot":
        target = pathlib.Path(action.get("path", "ella-research-screenshot.png")).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        pyautogui.screenshot(str(target))
        result = {"operation": operation, "path": str(target)}
    elif operation == "click":
        pyautogui.click(int(action["x"]), int(action["y"]))
        result = {"operation": operation}
    elif operation == "type":
        pyautogui.write(str(action.get("text", "")), interval=0.01)
        result = {"operation": operation}
    elif operation == "scroll":
        pyautogui.scroll(int(action.get("clicks", -3)))
        result = {"operation": operation}
    else:
        raise ValueError("unsupported PyAutoGUI operation")
    set_tool_status("PyAutoGUI", "COMPLETE", operation)
    return result


def handle_job(job):
    operation = job.get("operation")
    if operation == "LIST_PROJECT_FILES":
        root = safe_path(job["workspace"])
        return {"files": [str(path.relative_to(root)) for path in root.rglob("*") if path.is_file()][:2000]}
    if operation == "READ_PROJECT_FILE":
        path = safe_path(job["path"])
        return {"path": str(path), "content": path.read_text(encoding="utf-8")[:MAX_BODY]}
    if operation in ("CREATE_FILE", "EDIT_FILE"):
        path = safe_path(job["path"])
        content = str(job.get("content", ""))
        if not content or len(content.encode("utf-8")) > MAX_BODY:
            raise ValueError("file content is empty or exceeds worker limit")
        if operation == "EDIT_FILE" and not path.exists():
            raise ValueError("EDIT_FILE requires an existing file")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return {"path": str(path), "operation": operation, "bytes": len(content.encode("utf-8"))}
    if operation == "RUN_ALLOWED_TEST":
        path = safe_path(job["path"])
        if not path.is_file():
            raise ValueError("test target does not exist")
        if path.suffix != ".py":
            raise ValueError("only Python syntax checks are currently allowlisted")
        result = subprocess.run(["python", "-m", "py_compile", str(path)], capture_output=True, text=True, timeout=30)
        return {"path": str(path), "passed": result.returncode == 0, "stdout": result.stdout[-4000:], "stderr": result.stderr[-4000:]}
    if operation == "CREATE_CODING_TASK":
        if not str(job.get("taskId", "")).strip() or not str(job.get("description", "")).strip():
            raise ValueError("coding taskId and description are required")
        safe_path(job["workspace"])
        return {"status": "UNAVAILABLE", "taskId": job["taskId"], "reason": "This worker has no VS Code/Copilot session API. No chat was opened and no code was changed.", "supportedNextStep": "Use explicit CREATE_FILE, EDIT_FILE, and RUN_ALLOWED_TEST operations from the coordinator."}
    if operation == "RESEARCH":
        urls = job.get("urls", [])
        if not isinstance(urls, list) or len(urls) > 10:
            raise ValueError("RESEARCH requires up to 10 URLs")
        pages = [fetch_page(str(url)) for url in urls]
        summary = " ".join(page["text"][:2000] for page in pages)[:10000]
        claims = [claim for page in pages for claim in page.get("claims", [])]
        return {"summary": summary, "claims": claims[:40], "pages": pages, "sources": [{"url": page["url"], "title": page["title"], "method": page.get("method")} for page in pages], "toolStatus": dict(TOOL_STATUS)}
    if operation == "GUI_ACTION":
        result = run_pyautogui_action(job)
        return {"toolStatus": dict(TOOL_STATUS), "result": result}
    raise ValueError("unsupported worker operation")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self.reply(200, {"workerId": WORKER_ID, "status": "ONLINE", "capabilities": ["RESEARCH", "GUI_ACTION", "READ_PROJECT_FILE", "LIST_PROJECT_FILES", "CREATE_FILE", "EDIT_FILE", "RUN_ALLOWED_TEST", "CREATE_CODING_TASK"], "currentTask": None, "copilotSession": "UNAVAILABLE", "researchTool": dict(TOOL_STATUS)})

    def do_POST(self):
        if self.path != "/task":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        signature = self.headers.get("X-Ella-Signature", "")
        expected = hmac.new(TOKEN.encode(), body, hashlib.sha256).hexdigest()
        if not TOKEN or not hmac.compare_digest(signature, expected):
            self.send_error(401)
            return
        try:
            result = handle_job(json.loads(body))
            self.reply(200, {"task": "COMPLETE", "workerId": WORKER_ID, "result": result})
        except Exception as error:
            self.reply(400, {"task": "ERROR", "workerId": WORKER_ID, "error": str(error)})

    def reply(self, code, data):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        return


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("ELLA_WORKER_TOKEN is required")
    if not ROOTS:
        raise SystemExit("ELLA_WORKSPACES must contain at least one allowed directory")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
