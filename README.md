# 🎬 ClipHive

YouTube, Instagram, TikTok 영상을 최고 화질로 다운로드할 수 있는 웹 애플리케이션입니다.

## ✨ 주요 기능

- 🔥 **최고 화질 다운로드**: 사용 가능한 최고 화질로 영상을 다운로드
- ⚡ **빠른 처리**: 최적화된 알고리즘으로 빠른 영상 정보 추출 및 다운로드
- 🔒 **안전함**: 서버에 파일을 저장하지 않아 개인정보 보호
- 📱 **반응형 디자인**: 모바일과 데스크톱 모두에서 완벽하게 작동
- 🎨 **모던한 UI**: cobalt.tools에서 영감을 받은 세련된 다크 테마

## 🌐 지원 플랫폼

- 📺 **YouTube** (youtube.com, youtu.be)
- 📸 **Instagram** (instagram.com)
- 🎵 **TikTok** (tiktok.com)

## 🚀 설치 및 실행

### 필요 조건

- Node.js 16.0 이상
- npm 또는 yarn
- Python 3.7 이상 (yt-dlp를 위해 필요)

### 1. 저장소 클론

```bash
git clone <repository-url>
cd ClipHive
```

### 2. 의존성 설치

```bash
npm install
```

### 3. yt-dlp 설치

Windows (PowerShell):
```powershell
# Chocolatey를 사용하는 경우
choco install yt-dlp

# 또는 pip을 사용
pip install yt-dlp
```

macOS:
```bash
# Homebrew를 사용하는 경우
brew install yt-dlp

# 또는 pip을 사용
pip install yt-dlp
```

Linux:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install yt-dlp

# 또는 pip을 사용
pip install yt-dlp
```

### 4. 서버 실행

개발 모드 (자동 재시작):
```bash
npm run dev
```

운영 모드:
```bash
npm start
```

### 5. 브라우저에서 접속

```
http://localhost:3000
```

## 🛠️ 프로젝트 구조

```
ClipHive/
├── package.json          # 프로젝트 설정 및 의존성
├── server.js             # Express 서버
├── public/               # 정적 파일들
│   ├── index.html        # 메인 HTML 페이지
│   ├── style.css         # 스타일시트
│   └── script.js         # 클라이언트 JavaScript
└── README.md             # 프로젝트 문서
```

## 📋 API 엔드포인트

### POST `/api/info`
영상 정보를 가져옵니다.

**요청:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**응답:**
```json
{
  "title": "영상 제목",
  "thumbnail": "썸네일 URL",
  "duration": 180,
  "uploader": "채널명",
  "formats": [{
    "format_id": "포맷 ID",
    "url": "다운로드 URL",
    "quality": "1080p",
    "filesize": 12345678
  }]
}
```

### POST `/api/download`
다운로드 링크를 생성합니다.

**요청:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**응답:**
```json
{
  "downloadUrl": "직접 다운로드 URL",
  "filename": "영상제목.mp4",
  "quality": "1080p"
}
```

## ⚙️ 환경 변수

환경 변수는 `.env` 파일에서 설정할 수 있습니다:

```env
PORT=3000
```

## 🚨 주의사항

- 이 애플리케이션은 **개인적 용도**로만 사용하세요
- 저작권 보호를 받는 콘텐츠의 무단 다운로드는 금지됩니다
- 각 플랫폼의 이용약관을 준수하세요
- 서버에 과부하를 주지 않도록 적절히 사용하세요

## 🔧 문제 해결

### 영상 다운로드가 안 되는 경우

1. **yt-dlp 업데이트**:
   ```bash
   pip install --upgrade yt-dlp
   ```

2. **URL 확인**: 지원되는 플랫폼의 올바른 URL인지 확인

3. **프라이빗 영상**: 비공개 또는 제한된 영상은 다운로드할 수 없습니다

### 서버 실행 오류

1. **포트 충돌**: 3000번 포트가 이미 사용 중인 경우 다른 포트 사용:
   ```bash
   PORT=3001 npm start
   ```

2. **의존성 문제**: node_modules 삭제 후 재설치:
   ```bash
   rm -rf node_modules
   npm install
   ```

## 📄 라이선스

MIT License

## 🤝 기여하기

1. 이 저장소를 포크하세요
2. 새로운 기능 브랜치를 만드세요 (`git checkout -b feature/amazing-feature`)
3. 변경사항을 커밋하세요 (`git commit -m 'Add some amazing feature'`)
4. 브랜치에 푸시하세요 (`git push origin feature/amazing-feature`)
5. Pull Request를 열어주세요

---

**⚠️ 면책 조항**: 이 도구는 교육 목적으로 제작되었습니다. 사용자는 저작권법과 각 플랫폼의 이용약관을 준수할 책임이 있습니다. 