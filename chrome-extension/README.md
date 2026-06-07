# YouTube MP3 Chrome Extension

유튜브 영상 페이지에 `MP3 다운로드` 버튼을 추가하는 Chrome 확장프로그램입니다.

## 설치

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 `Developer mode`를 켭니다.
3. `Load unpacked`를 누릅니다.
4. 이 폴더의 `chrome-extension` 폴더를 선택합니다.

## 서버 주소 설정

확장프로그램 아이콘을 누르고 서버 주소를 저장합니다.

로컬 서버:

```text
http://127.0.0.1:8765
```

ngrok 고정 도메인:

```text
https://heelless-tod-unsecretively.ngrok-free.dev
```

## 사용

1. Python 변환 서버가 PM2로 실행 중이어야 합니다.
2. 유튜브 영상 페이지를 엽니다.
3. 영상 제목 아래 `MP3 다운로드` 버튼을 누릅니다.
4. 변환 완료 후 Chrome 다운로드가 자동으로 시작됩니다.
