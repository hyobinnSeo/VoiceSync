require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const youtubeDl = require('youtube-dl-exec');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const textToSpeech = require('@google-cloud/text-to-speech');

const streamPipeline = promisify(pipeline);

const app = express();
const PORT = process.env.PORT || 3000;
const GENAI_MODEL_ID = 'gemini-2.5-pro';
const MAX_VIDEO_SIZE_BYTES = 80 * 1024 * 1024; // 80MB
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SOURCE_LANGUAGE_CODES = ['auto', 'en', 'es', 'ja', 'ko'];
const TARGET_LANGUAGE_CODES = ['en', 'es', 'ja', 'ko'];
const LANGUAGE_LABELS = {
    auto: '자동 감지',
    en: '영어',
    es: '스페인어',
    ja: '일본어',
    ko: '한국어'
};
const MAX_TTS_SEGMENTS = 200;
const MAX_TTS_TEXT_LENGTH = 500;
const TTS_SPEAKING_RATE = 1.3;
const DEFAULT_TTS_LANGUAGE = 'ko';
const TTS_VOICE_MAP = {
    en: {
        languageCode: 'en-US',
        name: 'en-US-Neural2-F'
    },
    es: {
        languageCode: 'es-ES',
        name: 'es-ES-Neural2-B'
    },
    ja: {
        languageCode: 'ja-JP',
        name: 'ja-JP-Neural2-C'
    },
    ko: {
        languageCode: 'ko-KR',
        name: 'ko-KR-Neural2-A'
    }
};

let cachedGenAi = null;
let cachedGeminiModel = null;
let cachedTextToSpeechClient = null;
let warnedMissingTtsCredentials = false;

function ensureGeminiModel() {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;

    if (!apiKey) {
        throw new Error('GOOGLE_GENAI_API_KEY 환경 변수가 설정되어 있지 않습니다.');
    }

    if (!cachedGenAi) {
        cachedGenAi = new GoogleGenerativeAI(apiKey);
    }

    if (!cachedGeminiModel) {
        cachedGeminiModel = cachedGenAi.getGenerativeModel({
            model: GENAI_MODEL_ID
        });
    }

    return cachedGeminiModel;
}

function ensureTextToSpeechClient() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !warnedMissingTtsCredentials) {
        warnedMissingTtsCredentials = true;
        console.warn(
            '[TTS] GOOGLE_APPLICATION_CREDENTIALS 환경 변수가 설정되어 있지 않습니다. ' +
            '서비스 계정 키 파일 경로를 설정하지 않으면 TTS 요청이 실패할 수 있습니다.'
        );
    }

    if (!cachedTextToSpeechClient) {
        cachedTextToSpeechClient = new textToSpeech.TextToSpeechClient();
    }

    return cachedTextToSpeechClient;
}

function normalizeLanguageOptions(rawOptions = {}) {
    const sourceCandidate =
        typeof rawOptions?.sourceLanguage === 'string'
            ? rawOptions.sourceLanguage.toLowerCase()
            : 'auto';
    const targetCandidate =
        typeof rawOptions?.targetLanguage === 'string'
            ? rawOptions.targetLanguage.toLowerCase()
            : 'ko';

    const sourceLanguage = SOURCE_LANGUAGE_CODES.includes(sourceCandidate)
        ? sourceCandidate
        : 'auto';
    const targetLanguage = TARGET_LANGUAGE_CODES.includes(targetCandidate)
        ? targetCandidate
        : 'ko';

    return { sourceLanguage, targetLanguage };
}

function parseTimecodeToSeconds(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return NaN;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return NaN;
    }

    if (/^\d+(\.\d+)?$/.test(trimmed)) {
        return Number.parseFloat(trimmed);
    }

    const parts = trimmed.split(':').map((part) => Number.parseFloat(part));
    if (parts.some((part) => Number.isNaN(part))) {
        return NaN;
    }

    let seconds = 0;
    for (let i = 0; i < parts.length; i += 1) {
        seconds = seconds * 60 + parts[i];
    }

    return seconds;
}

function formatSecondsToTimecode(seconds) {
    const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const totalSeconds = Math.floor(safeSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return [
        hours.toString().padStart(2, '0'),
        minutes.toString().padStart(2, '0'),
        secs.toString().padStart(2, '0')
    ].join(':');
}

function normalizeTranscriptItems(items = []) {
    if (!Array.isArray(items)) {
        return [];
    }

    const normalized = [];

    items.forEach((item) => {
        if (!item || typeof item !== 'object') {
            return;
        }

        const text = (item.text ?? '').toString().trim();
        if (!text) {
            return;
        }

        const startSeconds = parseTimecodeToSeconds(
            item.start ?? item.startSeconds ?? item.begin ?? item.start_time
        );
        const endSeconds = parseTimecodeToSeconds(
            item.end ?? item.endSeconds ?? item.finish ?? item.end_time
        );

        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
            return;
        }

        const safeStart = Math.max(0, startSeconds);
        const safeEnd = endSeconds > safeStart ? endSeconds : safeStart + 0.4;

        normalized.push({
            start: formatSecondsToTimecode(safeStart),
            end: formatSecondsToTimecode(safeEnd),
            startSeconds: safeStart,
            endSeconds: safeEnd,
            text
        });
    });

    normalized.sort((a, b) => a.startSeconds - b.startSeconds);

    return normalized;
}

function extractJsonArrayFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return rawText;
    }

    const trimmed = rawText.trim();
    if (!trimmed) {
        return trimmed;
    }

    // 코드 블록(```json ... ```) 제거
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
        return fencedMatch[1].trim();
    }

    // HTML 프리태그 제거
    const preMatch = trimmed.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (preMatch && preMatch[1]) {
        return preMatch[1].trim();
    }

    // JSON 배열만 남기기
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        return arrayMatch[0].trim();
    }

    return trimmed;
}

function buildTranscriptPrompt(options = {}) {
    const { sourceLanguage, targetLanguage } = normalizeLanguageOptions(options);

    const sourceInstruction =
        sourceLanguage === 'auto'
            ? '원본 음성 언어를 자동으로 감지하세요. 감지가 불확실하면 그 사실을 언급하세요.'
            : `원본 음성은 ${LANGUAGE_LABELS[sourceLanguage]}입니다. 해당 언어를 기준으로 음성을 이해하세요.`;

    const targetInstruction =
        sourceLanguage === targetLanguage
            ? `출력 문장은 ${LANGUAGE_LABELS[targetLanguage]} 원문 언어 그대로 자연스럽게 작성하세요.`
            : `출력 문장은 ${LANGUAGE_LABELS[targetLanguage]}로 자연스럽게 번역하여 작성하세요.`;

    const writingNote =
        targetLanguage === 'ko'
            ? '자연스러운 한국어 문장부호와 어순을 사용하세요.'
            : `문장부호와 어휘는 ${LANGUAGE_LABELS[targetLanguage]}에 맞게 자연스럽게 구성하세요.`;

    const translationNote =
        sourceLanguage === targetLanguage
            ? '원본 언어를 그대로 사용하되, 문장을 명확하고 자연스럽게 다듬으세요.'
            : `${LANGUAGE_LABELS[targetLanguage]} 독자가 이해하기 쉽게 완전한 번역을 제공하세요. 번역 누락 없이 원문의 의미를 모두 포함시키고, 대상 언어 특유의 자연스러운 표현을 사용하세요.`;

    return [
        '다음에 제공되는 영상 파일의 음성을 문장 단위로 분석하여 스크립트를 작성하세요.',
        sourceInstruction,
        targetInstruction,
        translationNote,
        '각 문장마다 시작 시간과 종료 시간을 모두 포함하고, 시간은 항상 HH:MM:SS 포맷으로 맞춰주세요.',
        '출력은 JSON 배열 형식으로 반환하며, 각 객체는 start, end, text 키를 가져야 합니다.',
        '예시: [{"start":"00:00:00","end":"00:00:04","text":"첫 문장"}]',
        '음성이 없거나 들리지 않으면 빈 배열을 반환하세요.',
        writingNote,
        '의미 단위를 명확히 구분하고, 불필요한 설명은 포함하지 마세요.',
        '반드시 JSON 배열만 출력하고, 코드 블록(```)이나 추가 설명, 주석을 포함하지 마세요.',
        'JSON 이외의 텍스트가 섞이지 않도록 주의하세요.',
        'text 값에는 지정된 출력 언어만 사용하고, 다른 언어가 섞이지 않도록 주의하세요.'
    ].join('\n');
}

async function synthesizeTtsSegments(items, languageOptions) {
    if (!Array.isArray(items) || items.length === 0) {
        console.log('[TTS] 스크립트 항목이 없어 TTS를 생성하지 않습니다.');
        return [];
    }

    const normalizedOptions = normalizeLanguageOptions(languageOptions);
    const { targetLanguage } = normalizedOptions;
    const ttsClient = ensureTextToSpeechClient();
    const voiceConfig = TTS_VOICE_MAP[targetLanguage] || TTS_VOICE_MAP[DEFAULT_TTS_LANGUAGE];
    const voiceSelection = {
        languageCode: voiceConfig.languageCode,
        name: voiceConfig.name
    };
    const audioConfig = {
        audioEncoding: 'MP3',
        speakingRate: TTS_SPEAKING_RATE
    };
    const segments = [];

    for (let index = 0; index < items.length && index < MAX_TTS_SEGMENTS; index += 1) {
        const item = items[index];
        const originalText = (item.text ?? '').toString().trim();
        if (!originalText) {
            console.log('[TTS] 빈 텍스트 항목을 건너뜁니다.', { index });
            continue;
        }

        const truncatedText =
            originalText.length > MAX_TTS_TEXT_LENGTH
                ? `${originalText.slice(0, MAX_TTS_TEXT_LENGTH)}…`
                : originalText;

        try {
            console.log(
                '[TTS] TTS 요청 시작',
                JSON.stringify({ index, targetLanguage, languageCode: voiceSelection.languageCode, voice: voiceSelection.name })
            );

            const [response] = await ttsClient.synthesizeSpeech({
                input: { text: truncatedText },
                voice: voiceSelection,
                audioConfig
            });

            const audioContent = response?.audioContent;
            if (!audioContent) {
                console.warn('[TTS] 응답에 오디오 데이터가 없습니다.', { index });
                continue;
            }

            let audioContentBase64;
            if (Buffer.isBuffer(audioContent)) {
                audioContentBase64 = audioContent.toString('base64');
            } else if (typeof audioContent === 'string') {
                audioContentBase64 = audioContent;
            } else {
                audioContentBase64 = Buffer.from(audioContent).toString('base64');
            }

            segments.push({
                start: item.start,
                end: item.end,
                startSeconds: item.startSeconds,
                endSeconds: item.endSeconds,
                text: originalText,
                audioMimeType: 'audio/mpeg',
                audioContent: audioContentBase64
            });
            console.log('[TTS] TTS 생성 완료', JSON.stringify({ index, mimeType: 'audio/mpeg' }));
        } catch (error) {
            console.error('[TTS] 생성 오류', {
                index,
                message: error?.message,
                cause: error?.cause
            });
        }
    }

    if (segments.length === 0) {
        console.warn('[TTS] 생성된 오디오 세그먼트가 없습니다.');
    }

    return segments;
}

function buildStreamHeaders(remoteUrl, sourceUrl) {
    const headers = {
        'User-Agent': USER_AGENT
    };

    if (
        (remoteUrl && remoteUrl.includes('instagram.com')) ||
        (sourceUrl && sourceUrl.includes('instagram.com')) ||
        (remoteUrl && remoteUrl.includes('cdninstagram.com'))
    ) {
        headers['Referer'] = 'https://www.instagram.com/';
    }

    return headers;
}

function getMimeTypeFromExt(ext) {
    switch ((ext || '').toLowerCase()) {
        case 'mp4':
            return 'video/mp4';
        case 'webm':
            return 'video/webm';
        case 'mov':
            return 'video/quicktime';
        case 'mkv':
            return 'video/x-matroska';
        default:
            return 'video/mp4';
    }
}

function getExtensionFromMime(mimeType) {
    switch ((mimeType || '').toLowerCase()) {
        case 'video/mp4':
            return 'mp4';
        case 'video/webm':
            return 'webm';
        case 'video/quicktime':
            return 'mov';
        case 'video/x-matroska':
            return 'mkv';
        default:
            return 'mp4';
    }
}

async function downloadRemoteVideo(remoteUrl, sourceUrl) {
    const headers = buildStreamHeaders(remoteUrl, sourceUrl);
    const response = await fetch(remoteUrl, { headers });

    if (!response.ok) {
        throw new Error(`원격 영상 다운로드에 실패했습니다. (status: ${response.status})`);
    }

    if (!response.body) {
        throw new Error('원격 영상 스트림을 가져올 수 없습니다.');
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const contentLengthHeader = response.headers.get('content-length');

    if (contentLengthHeader && Number(contentLengthHeader) > MAX_VIDEO_SIZE_BYTES) {
        throw new Error('영상 파일이 너무 커서 분석할 수 없습니다. 80MB 이하의 영상을 사용해주세요.');
    }

    const extension = getExtensionFromMime(contentType);
    const tempFilename = `remote-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
    const filePath = path.join(tempDir, tempFilename);

    await streamPipeline(response.body, fs.createWriteStream(filePath));

    const stats = await fs.promises.stat(filePath);
    if (stats.size > MAX_VIDEO_SIZE_BYTES) {
        await fs.promises.unlink(filePath).catch(() => {});
        throw new Error('영상 파일이 너무 커서 분석할 수 없습니다. 80MB 이하의 영상을 사용해주세요.');
    }

    return {
        filePath,
        mimeType: contentType
    };
}

// 업로드 디렉토리 설정
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp4';
        const baseName = path.basename(file.originalname, ext).replace(/[^\w\-]+/g, '_') || 'video';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${baseName}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 200 * 1024 * 1024 // 200MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('영상 파일만 업로드할 수 있습니다.'));
        }
    }
});

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsDir));

// 메인 페이지
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 사용자 영상 업로드 API
app.post('/api/upload', (req, res) => {
    upload.single('video')(req, res, (err) => {
        if (err) {
            console.error('업로드 오류:', err);
            return res.status(400).json({ error: err.message || '영상 업로드에 실패했습니다.' });
        }

        if (!req.file) {
            return res.status(400).json({ error: '영상 파일을 업로드해주세요.' });
        }

        const { filename, originalname, size, mimetype } = req.file;

        res.json({
            title: path.parse(originalname).name || '내 영상',
            thumbnail: null,
            duration: null,
            uploader: '사용자 업로드',
            quality: '사용자 업로드',
            hasAudio: undefined,
            codec: 'unknown',
            streamUrl: `/uploads/${encodeURIComponent(filename)}`,
            directUrl: `/uploads/${encodeURIComponent(filename)}`,
            filename,
            filesize: size,
            sourceType: 'local',
            transcriptSource: {
                type: 'local',
                filename,
                mimeType: mimetype || 'video/mp4'
            }
        });
    });
});

// 영상 정보 가져오기 및 다운로드 API (통합)
app.post('/api/download', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: '링크를 입력해주세요.' });
        }

        console.log('다운로드 요청 URL:', url);

        // URL 유효성 검사
        const isInstagramReel = url.includes('instagram.com') && url.includes('/reel');
        
        if (!isInstagramReel) {
            return res.status(400).json({ error: 'Instagram 릴스 링크만 지원합니다.' });
        }

        // 플랫폼별 설정
        let dlOptions = {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            format: 'best[ext=mp4]/best',
            mergeOutputFormat: 'mp4'
        };

        dlOptions.addHeader = [
            'referer:https://www.instagram.com/',
            'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        ];

        const info = await youtubeDl(url, dlOptions);

        // 최적 포맷 선택
        const formats = info.formats || [];
        let bestFormat = null;

        // 오디오+비디오 통합 포맷 우선
        const combinedFormats = formats.filter(f => 
            f.vcodec && f.vcodec !== 'none' && 
            f.acodec && f.acodec !== 'none' &&
            f.ext === 'mp4' && 
            f.protocol === 'https'
        );

        if (combinedFormats.length > 0) {
            if (url.includes('tiktok.com')) {
                // TikTok: H.264 우선 선택
                const h264Formats = combinedFormats.filter(f => 
                    f.vcodec && f.vcodec.includes('h264') && f.height
                );
                const targetFormats = h264Formats.length > 0 ? h264Formats : combinedFormats;
                bestFormat = targetFormats.reduce((best, current) => {
                    if (!best) return current;
                    if (current.height > best.height) return current;
                    if (current.height === best.height && current.filesize > best.filesize) return current;
                    return best;
                }, null);
            } else {
                // YouTube, Instagram: 최고 화질 선택
                const definedHeightFormats = combinedFormats.filter(f => f.height);
                const targetFormats = definedHeightFormats.length > 0 ? definedHeightFormats : combinedFormats;
                bestFormat = targetFormats.reduce((best, current) => {
                    if (!best) return current;
                    if (current.height > best.height) return current;
                    if (current.height === best.height && current.filesize > best.filesize) return current;
                    return best;
                }, null);
            }
        } else {
            // 통합 포맷이 없는 경우
            if (url.includes('instagram.com')) {
                // Instagram: 숫자 ID 포맷 우선 (오디오 포함)
                const numericFormats = formats.filter(f => 
                    f.format_id && /^\d+$/.test(f.format_id) && f.height
                );
                if (numericFormats.length > 0) {
                    bestFormat = numericFormats.reduce((best, current) => {
                        if (!best) return current;
                        if (current.height > best.height) return current;
                        return best;
                    }, null);
                }
            }

            // 대안: 비디오 전용 포맷
            if (!bestFormat) {
                const videoFormats = formats.filter(f => 
                    f.vcodec && f.vcodec !== 'none' && 
                    f.ext === 'mp4' && 
                    f.protocol === 'https'
                );
                if (videoFormats.length > 0) {
                    bestFormat = videoFormats.reduce((best, current) => {
                        if (!best) return current;
                        if (current.height > best.height) return current;
                        return best;
                    }, null);
                }
            }
        }

        if (!bestFormat || !bestFormat.url) {
            return res.status(404).json({ error: '재생 가능한 영상을 찾을 수 없습니다.' });
        }

        // 안전한 파일명 생성
        const safeFilename = `${info.title?.replace(/[<>:"/\\|?*]/g, '_') || 'video'}.${bestFormat.ext || 'mp4'}`;
        
        // 응답 데이터
        res.json({
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            uploader: info.uploader,
            quality: `${bestFormat.height}p`,
            hasAudio: bestFormat.acodec && bestFormat.acodec !== 'none',
            codec: bestFormat.vcodec || 'unknown',
            streamUrl: `/api/proxy-stream?url=${encodeURIComponent(bestFormat.url)}&filename=${encodeURIComponent(safeFilename)}&source=${encodeURIComponent(url)}`,
            directUrl: bestFormat.url,
            filename: safeFilename,
            filesize: bestFormat.filesize,
            sourceType: 'remote',
            sourceUrl: url,
            transcriptSource: {
                type: 'remote',
                remoteUrl: bestFormat.url,
                sourceUrl: url,
                mimeType: getMimeTypeFromExt(bestFormat.ext)
            }
        });

    } catch (error) {
        console.error('다운로드 오류:', error);
        console.error('다운로드 오류 메시지:', error?.message);
        if (error?.stderr) {
            console.error('다운로드 오류 stderr:', error.stderr);
        }
        if (error?.stdout) {
            console.error('다운로드 오류 stdout:', error.stdout);
        }
        if (error?.stack) {
            console.error('다운로드 오류 스택:', error.stack);
        }
        res.status(500).json({ 
            error: '영상 정보를 가져오는데 실패했습니다. 링크를 확인해주세요.' 
        });
    }
});

app.post('/api/transcribe', async (req, res) => {
    let filePath;
    let shouldCleanup = false;

    try {
        const { transcriptSource, languageOptions } = req.body || {};

        if (!transcriptSource || !transcriptSource.type) {
            return res.status(400).json({ error: '스크립트를 생성할 영상 정보가 필요합니다.' });
        }

        const normalizedLanguageOptions = normalizeLanguageOptions(languageOptions);
        const model = ensureGeminiModel();
        let mimeType = transcriptSource.mimeType || 'video/mp4';

        if (transcriptSource.type === 'local') {
            const safeFilename = path.basename(transcriptSource.filename || '');
            if (!safeFilename) {
                return res.status(400).json({ error: '로컬 영상 파일명이 필요합니다.' });
            }

            filePath = path.join(uploadsDir, safeFilename);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: '로컬 영상 파일을 찾을 수 없습니다.' });
            }
        } else if (transcriptSource.type === 'remote') {
            if (!transcriptSource.remoteUrl) {
                return res.status(400).json({ error: '원격 영상 URL이 필요합니다.' });
            }

            const downloadResult = await downloadRemoteVideo(
                transcriptSource.remoteUrl,
                transcriptSource.sourceUrl
            );

            filePath = downloadResult.filePath;
            mimeType = downloadResult.mimeType || mimeType;
            shouldCleanup = true;
        } else {
            return res.status(400).json({ error: '지원하지 않는 영상 소스 타입입니다.' });
        }

        const stats = await fs.promises.stat(filePath);

        if (stats.size > MAX_VIDEO_SIZE_BYTES) {
            throw new Error('영상 파일이 너무 커서 분석할 수 없습니다. 80MB 이하의 영상을 사용해주세요.');
        }

        const videoBuffer = await fs.promises.readFile(filePath);

        const result = await model.generateContent([
            {
                inlineData: {
                    data: videoBuffer.toString('base64'),
                    mimeType
                }
            },
            {
                text: buildTranscriptPrompt(normalizedLanguageOptions)
            }
        ]);

        const response = result.response;
        const transcriptText = response && typeof response.text === 'function' ? response.text() : null;

        if (!transcriptText) {
            console.warn('[Transcribe] Gemini 응답에 스크립트 텍스트가 없습니다.');
            throw new Error('모델이 스크립트를 생성하지 못했습니다.');
        }

        console.log(
            '[Transcribe] Gemini 스크립트 생성 완료',
            JSON.stringify({
                source: transcriptSource.type,
                mimeType,
                transcriptLength: transcriptText.length,
                languageOptions: normalizedLanguageOptions
            })
        );

        const sanitizedTranscriptText = extractJsonArrayFromText(transcriptText);
        let parsedTranscriptItems = [];
        try {
            parsedTranscriptItems = JSON.parse(sanitizedTranscriptText);
        } catch (parseError) {
            console.warn('스크립트 JSON 파싱 실패:', parseError?.message || parseError);
        }

        const normalizedTranscriptItems = normalizeTranscriptItems(parsedTranscriptItems);
        console.log(
            '[Transcribe] 정규화된 스크립트 항목',
            JSON.stringify({
                totalParsed: Array.isArray(parsedTranscriptItems) ? parsedTranscriptItems.length : null,
                normalizedCount: normalizedTranscriptItems.length
            })
        );

        let ttsSegments = [];

        if (normalizedTranscriptItems.length > 0) {
            ttsSegments = await synthesizeTtsSegments(normalizedTranscriptItems, normalizedLanguageOptions);
        }

        console.log(
            '[Transcribe] TTS 생성 결과',
            JSON.stringify({
                segmentsRequested: normalizedTranscriptItems.length,
                segmentsGenerated: ttsSegments.length
            })
        );

        res.json({
            transcript: transcriptText,
            languageOptions: normalizedLanguageOptions,
            items: normalizedTranscriptItems,
            ttsSegments,
            ttsConfig: {
                speakingRate: TTS_SPEAKING_RATE
            }
        });
    } catch (error) {
        console.error('스크립트 생성 오류:', error);

        const message = error?.message || '스크립트 생성 중 오류가 발생했습니다.';
        const status =
            message.includes('영상 파일이 너무 커서') ? 413 :
            message.includes('GOOGLE_GENAI_API_KEY') ? 500 :
            500;

        res.status(status).json({
            error: message
        });
    } finally {
        if (shouldCleanup && filePath) {
            fs.promises.unlink(filePath).catch((unlinkError) => {
                console.warn('임시 파일 삭제 실패:', unlinkError?.message);
            });
        }
    }
});

// 프록시 스트리밍 API
app.get('/api/proxy-stream', async (req, res) => {
    try {
        const { url, filename, source } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: '스트림 URL이 필요합니다.' });
        }

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        if (url.includes('instagram.com') || url.includes('cdninstagram.com')) {
            headers['Referer'] = 'https://www.instagram.com/';
        } else if (source && source.includes('instagram.com')) {
            headers['Referer'] = 'https://www.instagram.com/';
        }

        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const response = await fetch(url, { headers });

        if (!response.ok) {
            return res.status(response.status).json({ error: '영상을 가져올 수 없습니다.' });
        }

        res.status(response.status);

        const passthroughHeaders = ['content-type', 'content-length', 'accept-ranges', 'content-range'];
        passthroughHeaders.forEach((header) => {
            const value = response.headers.get(header);
            if (value) {
                res.setHeader(header, value);
            }
        });

        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename || 'video.mp4')}"`);

        response.body.pipe(res);

        response.body.on('error', (error) => {
            console.error('프록시 스트리밍 오류:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: '스트리밍 중 오류가 발생했습니다.' });
            }
        });
    } catch (error) {
        console.error('프록시 스트리밍 오류:', error);
        console.error('프록시 스트리밍 오류 메시지:', error?.message);
        if (error?.stack) {
            console.error('프록시 스트리밍 스택:', error.stack);
        }
        if (!res.headersSent) {
            res.status(500).json({ error: '스트리밍 처리 중 오류가 발생했습니다.' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`http://localhost:${PORT} 에서 접속하세요.`);
}); 