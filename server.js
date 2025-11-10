const express = require('express');
const cors = require('cors');
const path = require('path');
const youtubeDl = require('youtube-dl-exec');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 메인 페이지
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 영상 정보 가져오기 및 다운로드 API (통합)
app.post('/api/download', async (req, res) => {
    try {
        const { url, audioOption } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: '링크를 입력해주세요.' });
        }

        console.log('다운로드 요청 URL:', url);
        if (audioOption) {
            console.log('오디오 옵션:', audioOption);
        }

        // URL 유효성 검사
        const supportedPlatforms = ['youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com'];
        const isSupported = supportedPlatforms.some(platform => url.includes(platform));
        
        if (!isSupported) {
            return res.status(400).json({ error: '지원하지 않는 플랫폼입니다. (YouTube, Instagram, TikTok만 지원)' });
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

        if (url.includes('tiktok.com')) {
            dlOptions.addHeader = [
                'referer:https://www.tiktok.com/',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ];
            dlOptions.format = 'best[vcodec^=h264][height<=1920]/best[height<=1920]/best';
        } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
            dlOptions.addHeader = [
                'referer:https://www.youtube.com/',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            ];
        } else if (url.includes('instagram.com')) {
            dlOptions.addHeader = [
                'referer:https://www.instagram.com/',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            ];
        }

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
            return res.status(404).json({ error: '다운로드 가능한 영상을 찾을 수 없습니다.' });
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
            
            downloadUrl: url.includes('tiktok.com') ? 
                `/api/tiktok-download?url=${encodeURIComponent(bestFormat.url)}&filename=${encodeURIComponent(safeFilename)}&originalUrl=${encodeURIComponent(url)}` :
                `/api/proxy-download?url=${encodeURIComponent(bestFormat.url)}&filename=${encodeURIComponent(safeFilename)}`,
            directUrl: bestFormat.url,
            filename: safeFilename,
            filesize: bestFormat.filesize,
            isTikTok: url.includes('tiktok.com')
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

// TikTok 전용 다운로드 API
app.get('/api/tiktok-download', async (req, res) => {
    try {
        const { originalUrl, filename } = req.query;
        
        if (!originalUrl) {
            return res.status(400).json({ error: 'TikTok URL이 필요합니다.' });
        }

        // 임시 파일 경로 생성
        const tempId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const tempFilePath = path.join(__dirname, 'temp', `tiktok_${tempId}.%(ext)s`);
        
        // temp 디렉토리 생성
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // TikTok 다운로드
        await youtubeDl(originalUrl, {
            output: tempFilePath,
            format: 'best[vcodec^=h264][height<=1920]/best[height<=1920]/best',
            noCheckCertificates: true,
            noWarnings: true,
            addHeader: [
                'referer:https://www.tiktok.com/',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            ]
        });

        // 다운로드된 파일 찾기
        const tempFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(`tiktok_${tempId}`));
        if (tempFiles.length === 0) {
            throw new Error('다운로드된 파일을 찾을 수 없습니다.');
        }

        const downloadedFile = path.join(tempDir, tempFiles[0]);

        // 파일 스트리밍
        const fileStats = fs.statSync(downloadedFile);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', fileStats.size);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'tiktok_video.mp4')}"`);
        
        const fileStream = fs.createReadStream(downloadedFile);
        fileStream.pipe(res);

        // 임시 파일 정리
        fileStream.on('end', () => {
            fs.unlink(downloadedFile, (err) => {
                if (err) console.error('임시 파일 삭제 오류:', err);
            });
        });

    } catch (error) {
        console.error('TikTok 다운로드 오류:', error);
        console.error('TikTok 다운로드 오류 메시지:', error?.message);
        if (error?.stderr) {
            console.error('TikTok 다운로드 stderr:', error.stderr);
        }
        if (error?.stdout) {
            console.error('TikTok 다운로드 stdout:', error.stdout);
        }
        if (error?.stack) {
            console.error('TikTok 다운로드 스택:', error.stack);
        }
        
        // 오류 안내 페이지
        res.status(500).send(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>TikTok 다운로드 실패</title>
                <style>
                    body { 
                        font-family: 'Inter', sans-serif; 
                        background: #0a0a0a; 
                        color: #ffffff; 
                        padding: 2rem; 
                        max-width: 600px; 
                        margin: 0 auto; 
                        line-height: 1.6;
                    }
                    .container { 
                        background: #1a1a1a; 
                        padding: 2rem; 
                        border-radius: 12px; 
                        border: 1px solid #333; 
                    }
                    .title { 
                        color: #ff6b6b; 
                        font-size: 1.5rem; 
                        margin-bottom: 1rem; 
                    }
                    .method { 
                        background: #252525; 
                        padding: 1rem; 
                        border-radius: 8px; 
                        margin-bottom: 1rem; 
                        border-left: 3px solid #4ecdc4;
                    }
                    .button { 
                        background: #4ecdc4; 
                        color: #000; 
                        padding: 0.5rem 1rem; 
                        border-radius: 6px; 
                        text-decoration: none; 
                        display: inline-block; 
                        margin-top: 0.5rem;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2 class="title">🚫 TikTok 자동 다운로드 실패</h2>
                    <p>TikTok은 자동 다운로드를 차단하고 있습니다. 아래 방법을 사용해주세요:</p>
                    
                    <div class="method">
                        <h3>📱 모바일 앱 사용</h3>
                        <p>TikTok 앱 → 공유 → "링크 복사" → SnapTik, SSSTik 등 이용</p>
                    </div>
                    
                    <div class="method">
                        <h3>💻 브라우저 확장프로그램</h3>
                        <p>"TikTok Video Downloader" 확장프로그램 설치</p>
                    </div>
                    
                    <a href="/" class="button">← 메인 페이지로 돌아가기</a>
                </div>
            </body>
            </html>
        `);
    }
});

// 프록시 다운로드 API
app.get('/api/proxy-download', async (req, res) => {
    try {
        const { url, filename } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: '다운로드 URL이 필요합니다.' });
        }

        // 플랫폼별 헤더 설정
        let headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        if (url.includes('googlevideo.com') || url.includes('youtube.com')) {
            headers['Referer'] = 'https://www.youtube.com/';
        } else if (url.includes('instagram.com') || url.includes('cdninstagram.com')) {
            headers['Referer'] = 'https://www.instagram.com/';
        }

        // 파일 다운로드
        const response = await fetch(url, { headers });

        if (!response.ok) {
            return res.status(response.status).json({ error: '파일을 가져올 수 없습니다.' });
        }

        // 응답 헤더 설정
        const contentLength = response.headers.get('content-length');
        const contentType = response.headers.get('content-type') || 'video/mp4';
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'video.mp4')}"`);
        
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // 스트림 파이프
        response.body.pipe(res);
        
        response.body.on('error', (error) => {
            console.error('프록시 다운로드 오류:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: '다운로드 중 오류가 발생했습니다.' });
            }
        });

    } catch (error) {
        console.error('프록시 다운로드 오류:', error);
        console.error('프록시 다운로드 오류 메시지:', error?.message);
        if (error?.stack) {
            console.error('프록시 다운로드 스택:', error.stack);
        }
        if (!res.headersSent) {
            res.status(500).json({ error: '다운로드 처리 중 오류가 발생했습니다.' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`http://localhost:${PORT} 에서 접속하세요.`);
}); 