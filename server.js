const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const youtubeDl = require('youtube-dl-exec');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// 업로드 디렉토리 설정
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
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
app.use(express.json());
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

        const { filename, originalname, size } = req.file;

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
            filesize: size
        });
    });
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
            filesize: bestFormat.filesize
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