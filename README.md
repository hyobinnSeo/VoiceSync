# 🎬 VoiceSync (ClipHive)

Gemini와 Google Cloud Text-to-Speech를 활용해 영상의 음성 스크립트를 생성하고, 선택한 언어로 더빙을 제공하는 웹 애플리케이션입니다. Cloud Run에 배포하도록 설계되어 있으며, 로컬에서도 쉽게 실행할 수 있습니다.

---

## 🧭 목차
- [주요 기능](#주요-기능)
- [아키텍처](#아키텍처)
- [기본 요구 사항](#기본-요구-사항)
- [환경 변수](#환경-변수)
- [로컬 개발 가이드](#로컬-개발-가이드)
- [Cloud Run 배포](#cloud-run-배포)
- [사용 방법](#사용-방법)
- [보안 주의 사항](#보안-주의-사항)
- [문제 해결](#문제-해결)
- [라이선스](#라이선스)

---

## 주요 기능
- 🔊 **Gemini 기반 스크립트 생성**: 업로드/링크로 가져온 영상의 음성을 문장 단위로 추출
- 🌍 **다국어 더빙**: target 언어에 맞춰 Google Cloud TTS로 자연스러운 음성 합성
- 🖥️ **더빙 vs. 원본 동시 제공**: 더빙 영상과 원본 영상, 자막을 동시에 확인 가능
- 🧠 **언어 자동 감지**: 원본 언어를 자동 감지하고 필요 시 번역
- 🌐 **Cloud Run 친화적**: 컨테이너 기반 배포 및 GCP 인증 자동 처리

---

## 아키텍처
```
┌─────────────┐        ┌─────────────────┐        ┌────────────────────┐
│   Browser   │ <────> │ Express Server  │ <────> │  Gemini 2.5 Pro     │
│ (React-free │  HTTP  │   (Node.js)     │  REST  │  (Script generation)│
│   frontend) │        │                 │        └────────────────────┘
└──────┬──────┘        │                         ┌────────────────────┐
       │               │                         │ Cloud TTS           │
       │               └────────────────────────▶│ (Multilingual TTS)  │
       │                                          └────────────────────┘
       │  Media Link / Upload
       ▼
┌─────────────┐
│ Instagram   │
│ (yt-dlp)    │
└─────────────┘
```

---

## 기본 요구 사항
- **Node.js** 18 이상 (Cloud Run 기본 런타임과 호환)
- **npm** 또는 **yarn**
- **yt-dlp** (Instagram Reels, TikTok 다운로드용)
- **Google Cloud 계정** (Gemini & Text-to-Speech API 사용)
- **Docker** (Cloud Run 배포 전 이미지 빌드용)

---

## 환경 변수
프로젝트 루트에 `.env` (배포 환경에서는 Cloud Run에 직접 설정) 파일을 준비합니다.

```env
PORT=3000
GOOGLE_GENAI_API_KEY=your_gemini_api_key
```

> Cloud Run에서는 기본 서비스 계정으로 인증하므로 `GOOGLE_APPLICATION_CREDENTIALS`는 필요 없습니다. (Compute Engine 등 VM 환경에서만 별도 설정)

---

## 로컬 개발 가이드

1. **저장소 클론 & 의존성 설치**
   ```bash
   git clone <repository-url>
   cd ClipHive
   npm install
   ```

2. **yt-dlp 설치**  
   플랫폼 별 설치 방법은 [yt-dlp 공식 문서](https://github.com/yt-dlp/yt-dlp#installation)를 참고하세요.

3. **환경 변수 설정**
   ```powershell
   # Windows PowerShell
   setx GOOGLE_GENAI_API_KEY "your_gemini_api_key"
   ```
   또는 `.env` 파일에 정의합니다.

4. **개발 서버 실행**
   ```bash
   npm run dev  # nodemon 사용
   ```
   브라우저에서 `http://localhost:3000` 접속 후 UI를 확인합니다.

---

## Cloud Run 배포

### 1. gcloud 초기 설정
```bash
gcloud auth login
gcloud config set project voicesync-0
gcloud services enable run.googleapis.com texttospeech.googleapis.com
```

### 2. 컨테이너 이미지 빌드
```bash
gcloud builds submit --tag gcr.io/voicesync-0/cliphive:latest
```

### 3. 서비스 계정 권한
Cloud Run에서 사용할 서비스 계정에 아래 역할을 부여합니다.
- `roles/texttospeech.user`
- 필요 시 추가 권한 (예: Secret Manager를 사용한다면 해당 역할)

### 4. Cloud Run 배포
```bash
gcloud run deploy cliphive-service \
  --image gcr.io/voicesync-0/cliphive:latest \
  --platform managed \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --service-account cliphive-run@voicesync-0.iam.gserviceaccount.com \
  --set-env-vars GOOGLE_GENAI_API_KEY=your_gemini_api_key
```

### 5. 배포 검증
배포 후 제공되는 URL로 접속하여 UI 및 TTS 동작을 확인합니다. 문제가 있을 경우:
```bash
gcloud run services logs read cliphive-service
```
명령으로 로그를 확인하세요.

---

## 사용 방법
1. **Instagram Reels URL 입력** 또는 **영상 업로드**
2. **원본/출력 언어 선택** (자동 감지, 영어, 스페인어, 일본어, 한국어)
3. **재생 버튼 클릭**
4. 더빙 영상 자동 재생  
   - 아래에는 원본 영상 및 자막 영역이 별도로 제공돼 타임스탬프 별 텍스트를 확인 가능

---

## 보안 주의 사항
- 서비스 계정 키는 저장소에 커밋하지 말고, Cloud Run에서는 서비스 계정 바인딩만 사용하세요.
- Gemini API 키는 Cloud Run 환경 변수 또는 Secret Manager로 관리하세요.
- yt-dlp를 통해 다운로드 받는 콘텐츠는 각 플랫폼의 이용약관을 반드시 준수하세요.

---

## 문제 해결

| 문제 | 해결 방법 |
|------|-----------|
| TTS가 실패함 | Cloud Text-to-Speech API 활성화 및 서비스 계정 권한 확인 |
| 스크립트가 영어로만 나옴 | 출력 언어 선택이 올바른지 확인, Gemini API Key 사용량 제한 확인 |
| Cloud Run에서 인증 오류 | 배포 시 `--service-account` 옵션이 올바른지 확인 |
| Instagram 다운로드 실패 | yt-dlp 최신 버전인지 확인, 비공개/삭제된 영상 여부 확인 |

추가 이슈는 GitHub Issue 또는 팀 슬랙 채널로 공유해주세요.

---

## 라이선스

MIT License.  
기여를 환영합니다! PR 생성 전 이슈를 먼저 등록하면 협업이 더 수월합니다.