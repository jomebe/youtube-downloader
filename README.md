# YouTube MP3 Converter

유튜브 링크 하나를 입력하면 `yt-dlp`와 FFmpeg로 MP3 파일을 만드는 로컬 웹 앱입니다.

## 실행

1. 처음 한 번 `install.bat`을 실행합니다.
2. `start.bat`을 실행합니다.
3. 브라우저가 열리면 유튜브 링크를 붙여 넣고 `MP3 만들기`를 누릅니다.
4. 완성된 파일은 `downloads` 폴더에 저장됩니다.

## 웹 배포

Docker를 지원하는 호스팅(Render, Railway, Fly.io, VPS 등)에 올릴 수 있습니다.

### Render

1. 이 폴더를 GitHub 저장소로 올립니다.
2. Render에서 `New` → `Blueprint`를 선택합니다.
3. 저장소를 연결하면 `render.yaml` 설정으로 웹 서비스가 생성됩니다.
4. 배포가 끝나면 Render가 제공하는 주소로 접속합니다.

### Docker 직접 실행

```powershell
docker build -t youtube-mp3-converter .
docker run --rm -p 8765:8765 -e PORT=8765 youtube-mp3-converter
```

브라우저에서 `http://localhost:8765`로 접속하면 됩니다.

### PM2로 실행

서버에 Python, FFmpeg, PM2가 있어야 합니다.

```bash
sudo apt update
sudo apt install -y python3 python3-pip ffmpeg
npm install -g pm2
python3 -m pip install --upgrade -r requirements.txt
pm2 start ecosystem.config.cjs
pm2 save
```

접속 주소는 `http://서버IP:8765`입니다. 서버 방화벽이나 클라우드 보안 그룹에서 `8765` 포트를 열어야 합니다.

재부팅 후에도 자동 실행하려면 PM2가 출력하는 안내에 따라 아래 명령을 실행합니다.

```bash
pm2 startup
```

## 필요 항목

- Python 3
- FFmpeg 및 FFprobe
- yt-dlp

`yt-dlp`가 유튜브 변경 때문에 실패하면 `install.bat`을 다시 실행해서 최신 버전으로 업데이트하세요.

배포된 서버에서는 변환 파일이 기본 6시간 뒤 자동 정리됩니다. 공개 서비스로 운영하면 저작권과 호스팅 정책 문제가 생길 수 있으니 개인용 또는 제한된 접근으로 운영하세요.

### Render YouTube 인증

Render IP가 YouTube 봇 확인에 걸리면 Netscape 형식의 `cookies.txt`를 Base64로 인코딩해 Render Secret 환경변수로 등록합니다.

```text
YOUTUBE_COOKIES_BASE64
```

쿠키는 계정 로그인 권한을 포함하므로 GitHub 저장소에 파일로 올리면 안 됩니다.

## Chrome 확장프로그램

`chrome-extension` 폴더를 Chrome 확장프로그램으로 불러오면 유튜브 영상 아래에 `MP3 다운로드` 버튼이 생깁니다.

1. Chrome에서 `chrome://extensions`를 엽니다.
2. `Developer mode`를 켭니다.
3. `Load unpacked`로 `chrome-extension` 폴더를 선택합니다.
4. 확장프로그램 팝업에서 서버 주소를 저장합니다.

서버 주소 예:

```text
http://127.0.0.1:8765
https://youtube-downloader-8kya.onrender.com
```
