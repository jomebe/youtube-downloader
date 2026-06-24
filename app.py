from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DOWNLOAD_DIR = ROOT / "downloads"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DOWNLOAD_TTL_SECONDS = int(os.environ.get("DOWNLOAD_TTL_SECONDS", str(6 * 60 * 60)))

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


def youtube_cookie_file() -> Path | None:
    encoded = os.environ.get("YOUTUBE_COOKIES_BASE64", "").strip()
    if not encoded:
        return None

    cookie_path = ROOT / ".youtube-cookies.txt"
    try:
        cookie_data = base64.b64decode(encoded, validate=True)
        cookie_text = cookie_data.decode("utf-8").replace("\r\n", "\n")
    except (ValueError, UnicodeDecodeError):
        return None

    if not cookie_text.startswith(("# Netscape HTTP Cookie File", "# HTTP Cookie File")):
        return None

    cookie_path.write_text(cookie_text, encoding="utf-8", newline="\n")
    return cookie_path


def is_youtube_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False

    if parsed.scheme not in {"http", "https"}:
        return False

    host = (parsed.hostname or "").lower()
    return (
        host == "youtu.be"
        or host.endswith(".youtu.be")
        or host == "youtube.com"
        or host.endswith(".youtube.com")
        or host == "youtube-nocookie.com"
        or host.endswith(".youtube-nocookie.com")
    )


def append_log(job_id: str, line: str) -> None:
    line = line.strip()
    if not line:
        return

    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["log"].append(line[:1200])
        job["log"] = job["log"][-250:]
        job["updated_at"] = time.time()


def update_job(job_id: str, **fields: object) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = time.time()


def dependency_error() -> str | None:
    missing = []
    if shutil.which("ffmpeg") is None:
        missing.append("ffmpeg")
    if shutil.which("ffprobe") is None:
        missing.append("ffprobe")

    if missing:
        return (
            "FFmpeg가 필요합니다. "
            f"찾을 수 없는 항목: {', '.join(missing)}. "
            "FFmpeg를 설치하고 PATH에 추가한 뒤 다시 실행하세요."
        )

    probe = subprocess.run(
        [sys.executable, "-m", "yt_dlp", "--version"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if probe.returncode != 0:
        return (
            "yt-dlp가 설치되어 있지 않습니다. "
            "install.bat을 먼저 실행하거나 `python -m pip install -U yt-dlp`를 실행하세요."
        )

    return None


def write_job_cookies(job_dir: Path, cookies: list[dict]) -> Path | None:
    if not cookies:
        return None

    lines = ["# Netscape HTTP Cookie File"]
    for cookie in cookies:
        domain = str(cookie.get("domain", ""))
        name = str(cookie.get("name", "")).replace("\t", "").replace("\n", "")
        value = str(cookie.get("value", "")).replace("\t", "").replace("\n", "")
        domain_lower = domain.lower()
        if not (domain_lower == "youtube.com" or domain_lower.endswith(".youtube.com")) or not name:
            continue

        include_subdomains = "FALSE" if cookie.get("hostOnly") else "TRUE"
        path = str(cookie.get("path", "/"))
        secure = "TRUE" if cookie.get("secure") else "FALSE"
        expires = int(cookie.get("expirationDate") or 0)
        lines.append(
            "\t".join([domain, include_subdomains, path, secure, str(expires), name, value])
        )

    if len(lines) == 1:
        return None

    cookie_path = job_dir / "cookies.txt"
    cookie_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return cookie_path


def run_conversion(job_id: str, url: str, cookies: list[dict]) -> None:
    job_dir = DOWNLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    update_job(job_id, status="running")
    append_log(job_id, "변환 준비 중...")

    error = dependency_error()
    if error:
        update_job(job_id, status="failed", error=error)
        append_log(job_id, error)
        return

    output_template = str(job_dir / "%(title).180B [%(id)s].%(ext)s")
    base_command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "-f",
        "bestaudio/best",
        "--no-playlist",
        "--windows-filenames",
        "--newline",
        "--concurrent-fragments",
        "5",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "128K",
    ]
    cookie_path = write_job_cookies(job_dir, cookies) or youtube_cookie_file()
    if cookie_path:
        base_command.extend(["--cookies", str(cookie_path)])
    else:
        # 사용자 쿠키가 없을 때만 외부 JS 솔버 및 원격 컴포넌트 다운로드 로직 활성화
        base_command.extend(["--remote-components", "ejs:npm"])

    append_log(job_id, "다운로드와 MP3 변환을 시작합니다...")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"

    try:
        client_profiles = [None]
        if not cookie_path:
            client_profiles.append("tv_simply,web_embedded")

        exit_code = 1
        for index, player_clients in enumerate(client_profiles):
            command = list(base_command)
            if player_clients:
                append_log(job_id, "다른 YouTube 클라이언트로 다시 시도합니다...")
                command.extend(
                    [
                        "--extractor-args",
                        f"youtube:player_client={player_clients};player_skip=webpage",
                    ]
                )
            command.extend(["-o", output_template, url])

            try:
                process = subprocess.Popen(
                    command,
                    cwd=ROOT,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                )
            except OSError as exc:
                message = f"변환기를 시작하지 못했습니다: {exc}"
                update_job(job_id, status="failed", progress=0, error=message)
                append_log(job_id, message)
                return

            assert process.stdout is not None
            while True:
                line = process.stdout.readline()
                if not line:
                    break
                append_log(job_id, line)
                
                # 실시간 진행률 파싱
                if "[download]" in line:
                    match = re.search(r'\[download\]\s+(\d+(?:\.\d+)?)%', line)
                    if match:
                        try:
                            pct = float(match.group(1))
                            # 다운로드 진행률은 최대 90%로 스케일링 (MP3 후처리를 고려)
                            val = int(pct * 0.9)
                            update_job(job_id, progress=val)
                        except ValueError:
                            pass
                elif any(word in line for word in ["[ExtractAudio]", "[ffmpeg]", "Destination:"]):
                    update_job(job_id, progress=95)

            exit_code = process.wait()
            if exit_code == 0:
                break

            if index < len(client_profiles) - 1:
                for partial in job_dir.glob("*.part"):
                    partial.unlink(missing_ok=True)
    finally:
        job_cookie_path = job_dir / "cookies.txt"
        job_cookie_path.unlink(missing_ok=True)

    mp3_files = sorted(job_dir.glob("*.mp3"), key=lambda item: item.stat().st_mtime, reverse=True)

    if exit_code != 0:
        with JOBS_LOCK:
            recent_log = JOBS.get(job_id, {}).get("log", [])[-8:]
        detail = next(
            (
                line
                for line in reversed(recent_log)
                if "ERROR:" in line or "WARNING:" in line
            ),
            "",
        )
        message = detail or "변환에 실패했습니다. yt-dlp 로그를 확인하세요."
        update_job(job_id, status="failed", progress=0, error=message)
        append_log(job_id, message)
        return

    if not mp3_files:
        message = "변환은 끝났지만 MP3 파일을 찾지 못했습니다."
        update_job(job_id, status="failed", progress=0, error=message)
        append_log(job_id, message)
        return

    file_path = mp3_files[0]
    relative_path = file_path.relative_to(DOWNLOAD_DIR).as_posix()
    update_job(
        job_id,
        status="done",
        progress=100,
        file_name=file_path.name,
        file_url=f"/files/{relative_path}",
    )
    append_log(job_id, f"완료: {file_path.name}")


def make_job(url: str, cookies: list[dict]) -> str:
    job_id = uuid.uuid4().hex[:12]
    now = time.time()
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "url": url,
            "status": "queued",
            "progress": 0,
            "log": [],
            "error": None,
            "file_name": None,
            "file_url": None,
            "created_at": now,
            "updated_at": now,
        }

    thread = threading.Thread(target=run_conversion, args=(job_id, url, cookies), daemon=True)
    thread.start()
    return job_id


def cleanup_old_downloads() -> None:
    while True:
        cutoff = time.time() - DOWNLOAD_TTL_SECONDS

        with JOBS_LOCK:
            old_job_ids = [
                job_id
                for job_id, job in JOBS.items()
                if job.get("updated_at", 0) < cutoff and job.get("status") in {"done", "failed"}
            ]
            for job_id in old_job_ids:
                JOBS.pop(job_id, None)

        if DOWNLOAD_DIR.exists():
            for path in DOWNLOAD_DIR.iterdir():
                try:
                    if path.stat().st_mtime >= cutoff:
                        continue
                    if path.is_dir():
                        shutil.rmtree(path)
                    else:
                        path.unlink()
                except OSError:
                    pass

        time.sleep(30 * 60)


def json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class ConverterHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/":
            self.serve_file(STATIC_DIR / "index.html")
            return

        if parsed.path.startswith("/static/"):
            rel = unquote(parsed.path.removeprefix("/static/"))
            self.serve_file_safely(STATIC_DIR, rel)
            return

        if parsed.path.startswith("/files/"):
            rel = unquote(parsed.path.removeprefix("/files/"))
            self.serve_file_safely(DOWNLOAD_DIR, rel, as_attachment=True)
            return

        if parsed.path.startswith("/api/jobs/"):
            job_id = parsed.path.removeprefix("/api/jobs/").strip("/")
            self.handle_job_status(job_id)
            return

        self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/convert":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length > 131072:
            self.respond_json(413, {"error": "요청이 너무 큽니다."})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.respond_json(400, {"error": "요청 형식이 올바르지 않습니다."})
            return

        url = str(payload.get("url", "")).strip()
        if not is_youtube_url(url):
            self.respond_json(400, {"error": "유튜브 링크만 입력할 수 있습니다."})
            return

        cookies = payload.get("cookies", [])
        if not isinstance(cookies, list) or len(cookies) > 200:
            self.respond_json(400, {"error": "쿠키 형식이 올바르지 않습니다."})
            return

        job_id = make_job(url, cookies)
        self.respond_json(202, {"job_id": job_id})

    def handle_job_status(self, job_id: str) -> None:
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job:
                payload = dict(job)
            else:
                payload = None

        if payload is None:
            self.respond_json(404, {"error": "작업을 찾을 수 없습니다."})
            return

        self.respond_json(200, payload)

    def serve_file_safely(self, base: Path, relative: str, as_attachment: bool = False) -> None:
        base = base.resolve()
        target = (base / relative).resolve()

        if not target.is_relative_to(base) or not target.is_file():
            self.send_error(404)
            return

        self.serve_file(target, as_attachment=as_attachment)

    def serve_file(self, path: Path, as_attachment: bool = False) -> None:
        if not path.is_file():
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        file_size = path.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_size))
        if as_attachment:
            ascii_name = path.name.encode("ascii", "ignore").decode("ascii").replace('"', "")
            ascii_name = ascii_name or "download.mp3"
            encoded_name = quote(path.name)
            self.send_header(
                "Content-Disposition",
                f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded_name}",
            )
        self.end_headers()
        with path.open("rb") as file:
            shutil.copyfileobj(file, self.wfile)

    def respond_json(self, status: int, payload: object) -> None:
        data = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        return


def find_port(host: str) -> int:
    for port in range(DEFAULT_PORT, DEFAULT_PORT + 20):
        try:
            server = ThreadingHTTPServer((host, port), ConverterHandler)
        except OSError:
            continue
        server.server_close()
        return port
    raise RuntimeError("사용 가능한 포트를 찾지 못했습니다.")


def main() -> None:
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    host = os.environ.get("HOST", DEFAULT_HOST)
    port_env = os.environ.get("PORT")
    port = int(port_env) if port_env else find_port(host)
    display_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    url = f"http://{display_host}:{port}"
    server = ThreadingHTTPServer((host, port), ConverterHandler)
    threading.Thread(target=cleanup_old_downloads, daemon=True).start()

    print(f"YouTube MP3 변환기 실행 중: {url}")
    print("종료하려면 이 창에서 Ctrl+C를 누르세요.")
    if "--no-browser" not in sys.argv and not port_env:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
