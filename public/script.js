class ClipHive {
    constructor() {
        this.urlInput = document.getElementById('urlInput');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.pasteDownloadBtn = document.getElementById('pasteDownloadBtn');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.uploadInput = document.getElementById('uploadInput');
        this.resultSection = document.getElementById('result');
        this.errorSection = document.getElementById('error');
        
        // Result elements
        this.videoTitle = document.getElementById('videoTitle');
        this.videoUploader = document.getElementById('videoUploader');
        this.videoDuration = document.getElementById('videoDuration');
        this.videoQuality = document.getElementById('videoQuality');
        this.fileSize = document.getElementById('fileSize');
        this.videoPlayerContainer = document.getElementById('videoPlayerContainer');
        this.videoPlayer = document.getElementById('videoPlayer');
        this.originalVideoWrapper = document.getElementById('originalVideoWrapper');
        this.originalVideoPlayer = document.getElementById('originalVideoPlayer');
        this.originalSubtitleList = document.getElementById('originalSubtitleList');
        this.transcriptSection = document.getElementById('transcriptSection');
        this.transcriptContent = document.getElementById('transcriptContent');
        this.transcriptStatus = document.getElementById('transcriptStatus');
        this.transcriptRequestId = 0;
        this.sourceLanguageSelect = document.getElementById('sourceLanguageSelect');
        this.targetLanguageSelect = document.getElementById('targetLanguageSelect');
        this.lastTranscriptSource = null;
        this.lastTranscriptLanguageOptions = null;
        this.ttsSegments = [];
        this.activeTtsIndex = -1;
        this.isVideoPlaying = false;
        this.currentTranscriptItems = [];
        this.ttsSpeakingRate = 1;
        this.lastVideoTime = 0;
        this.originalSubtitleEntries = [];
        this.lastOriginalSubtitleIndex = -1;
        
        if (this.videoPlayer) {
            this.videoPlayer.muted = true;
            this.videoPlayer.defaultMuted = true;
            this.videoPlayer.addEventListener('error', () => {
                this.showError('영상 재생 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            });
            this.videoPlayer.addEventListener('timeupdate', () => {
                this.syncTtsWithVideo();
            });
            this.videoPlayer.addEventListener('seeked', () => {
                this.handleVideoSeeked();
            });
            this.videoPlayer.addEventListener('play', () => {
                this.handleVideoPlay();
            });
            this.videoPlayer.addEventListener('pause', () => {
                this.handleVideoPause();
            });
            this.videoPlayer.addEventListener('ended', () => {
                this.handleVideoEnded();
            });
            this.videoPlayer.addEventListener('ratechange', () => {
                this.syncTtsPlaybackRate();
            });
        }
        
        if (this.originalVideoPlayer) {
            this.originalVideoPlayer.addEventListener('timeupdate', () => {
                this.syncOriginalSubtitles();
            });
            this.originalVideoPlayer.addEventListener('seeked', () => {
                this.syncOriginalSubtitles(true);
            });
            this.originalVideoPlayer.addEventListener('play', () => {
                this.syncOriginalSubtitles();
            });
            this.originalVideoPlayer.addEventListener('pause', () => {
                this.syncOriginalSubtitles();
            });
            this.originalVideoPlayer.addEventListener('ended', () => {
                this.syncOriginalSubtitles();
            });
        }
        
        this.init();
        this.resetTranscript();
    }

    init() {
        this.downloadBtn.addEventListener('click', () => this.handleDownload());
        this.pasteDownloadBtn.addEventListener('click', () => this.handlePasteAndDownload());
        if (this.uploadBtn) {
            this.uploadBtn.addEventListener('click', () => this.handleUpload());
        }
        
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleDownload();
            }
        });
        
        // URL 입력시 에러 메시지 숨기기
        this.urlInput.addEventListener('input', () => {
            this.hideError();
        });

        if (this.uploadInput) {
            this.uploadInput.addEventListener('change', () => {
                this.hideError();
            });
        }

        if (this.sourceLanguageSelect) {
            this.sourceLanguageSelect.addEventListener('change', () => {
                this.handleLanguageOptionChange();
            });
        }

        if (this.targetLanguageSelect) {
            this.targetLanguageSelect.addEventListener('change', () => {
                this.handleLanguageOptionChange();
            });
        }
        
    }

    async handleUpload() {
        const file = this.uploadInput?.files?.[0];

        if (!file) {
            this.showError('업로드할 영상을 선택해주세요.');
            return;
        }

        this.setLoading(true, 'upload');
        this.hideError();
        this.hideResult();

        const formData = new FormData();
        formData.append('video', file);

        try {
            console.log('업로드 요청 시작:', file.name);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '영상 업로드에 실패했습니다.');
            }

            console.log('업로드 응답:', data);

            if (!data.streamUrl) {
                throw new Error('재생 가능한 영상 경로를 찾을 수 없습니다.');
            }

            this.displayVideoInfo(data);
            this.showResult();
            this.setOriginalVideoSource(data.directUrl || data.streamUrl || data.fallbackUrl);

            await this.generateTranscript(
                data.transcriptSource,
                this.getLanguageOptions()
            );
            await this.loadAndPlayVideo(data.streamUrl, data.directUrl);

        } catch (error) {
            console.error('영상 업로드 오류:', error);
            this.showError(error.message);
        } finally {
            this.setLoading(false, 'upload');
            if (this.uploadInput) {
                this.uploadInput.value = '';
            }
        }
    }

    async handleDownload(buttonType = 'download') {
        const url = this.urlInput.value.trim();
        
        if (!url) {
            this.showError('링크를 입력해주세요.');
            return;
        }

        if (!this.isValidUrl(url)) {
            this.showError('유효한 URL을 입력해주세요.');
            return;
        }

        this.setLoading(true, buttonType);
        this.hideError();
        this.hideResult();
        try {
            console.log('스트리밍 요청 시작:', url);
            
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    url 
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '영상 정보를 가져오는데 실패했습니다.');
            }

            console.log('서버 응답:', data);

            if (!data.streamUrl && !data.directUrl) {
                throw new Error('재생 가능한 스트림을 찾을 수 없습니다.');
            }

            this.displayVideoInfo(data);
            this.showResult();
            this.setOriginalVideoSource(data.directUrl || data.streamUrl || data.fallbackUrl);

            await this.generateTranscript(
                data.transcriptSource,
                this.getLanguageOptions()
            );
            await this.loadAndPlayVideo(data.streamUrl, data.directUrl);

        } catch (error) {
            console.error('영상 정보 가져오기 오류:', error);
            this.showError(error.message);
        } finally {
            this.setLoading(false, buttonType);
        }
    }

    async loadAndPlayVideo(streamUrl, fallbackUrl = null) {
        const playbackUrl = streamUrl || fallbackUrl;

        if (!playbackUrl) {
            throw new Error('재생 가능한 영상 URL이 없습니다.');
        }

        console.log('영상 스트림 로드 시작:', playbackUrl);

        this.videoPlayer.pause();
        this.videoPlayer.src = playbackUrl;
        this.videoPlayer.load();
        this.updateVideoAudioMode();
        this.syncTtsPlaybackRate();
        this.videoPlayerContainer.style.display = 'block';

        try {
            await this.videoPlayer.play();
            console.log('영상 재생 시작');
        } catch (error) {
            console.warn('영상 자동 재생 실패:', error);
            this.showError('자동 재생에 실패했습니다. 재생 버튼을 눌러주세요.');
        }
    }

    resetVideoPlayer() {
        if (this.videoPlayer) {
            this.videoPlayer.pause();
            this.videoPlayer.removeAttribute('src');
            this.videoPlayer.load();
        }
        if (this.videoPlayerContainer) {
            this.videoPlayerContainer.style.display = 'none';
        }
        this.setOriginalVideoSource(null);
    }

    displayVideoInfo(data) {
        this.videoTitle.textContent = data.title || '제목 없음';
        this.videoUploader.textContent = data.uploader || '업로더 정보 없음';
        
        // 재생 시간 포맷팅
        if (data.duration) {
            this.videoDuration.textContent = this.formatDuration(data.duration);
        } else {
            this.videoDuration.textContent = '시간 정보 없음';
        }
        
        // 화질 정보 (오디오 포함 여부와 코덱 정보도 표시)
        let qualityText = data.quality || '화질 정보 없음';
        if (data.hasAudio !== undefined) {
            qualityText += data.hasAudio ? ' (오디오 포함)' : ' (영상만)';
        }
        if (data.codec) {
            // 코덱 정보 간단히 표시
            const codecDisplay = data.codec.includes('h264') ? 'H.264' : 
                                 data.codec.includes('h265') || data.codec.includes('hevc') ? 'H.265' :
                                 data.codec.includes('vp9') ? 'VP9' :
                                 data.codec.includes('av01') ? 'AV1' : 'Unknown';
            qualityText += ` • ${codecDisplay}`;
        }
        this.videoQuality.textContent = qualityText;
        
        // 파일 크기 정보
        if (data.filesize) {
            this.fileSize.textContent = this.formatFileSize(data.filesize);
        } else {
            this.fileSize.textContent = '크기 정보 없음';
        }
    }

    resetTranscript() {
        if (!this.transcriptSection) return;

        this.stopAllTtsAudio();
        this.ttsSegments = [];
        this.activeTtsIndex = -1;
        this.isVideoPlaying = false;
        this.currentTranscriptItems = [];
        this.ttsSpeakingRate = 1;
        this.lastVideoTime = 0;
        this.updateVideoAudioMode();
        this.transcriptSection.style.display = 'none';
        if (this.transcriptContent) {
            this.transcriptContent.innerHTML = '';
        }
        this.setTranscriptStatus('');
        this.renderOriginalSubtitles(null);
        this.lastTranscriptSource = null;
        this.lastTranscriptLanguageOptions = null;
    }

    setTranscriptStatus(message) {
        if (!this.transcriptStatus) return;

        if (message) {
            this.transcriptStatus.textContent = message;
            this.transcriptStatus.style.display = 'inline';
        } else {
            this.transcriptStatus.textContent = '';
            this.transcriptStatus.style.display = 'none';
        }
    }

    renderTranscriptMessage(type, message) {
        if (!this.transcriptContent) return;

        this.transcriptContent.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = type;
        wrapper.textContent = message;
        this.transcriptContent.appendChild(wrapper);
        this.currentTranscriptItems = [];
        this.renderOriginalSubtitles(null);
    }

    renderTranscript(transcriptText, parsedItems = null) {
        if (!this.transcriptContent) return;

        if (!transcriptText || !transcriptText.trim()) {
            this.renderTranscriptMessage('transcript-empty', '생성된 스크립트가 없습니다.');
            return;
        }

        let parsed = Array.isArray(parsedItems) ? parsedItems : null;

        if (!parsed) {
            try {
                parsed = JSON.parse(transcriptText);
            } catch (_) {
                parsed = null;
            }
        }

        if (Array.isArray(parsed)) {
            if (parsed.length === 0) {
                this.renderTranscriptMessage('transcript-empty', '음성이 감지되지 않았습니다.');
                return;
            }

            this.transcriptContent.innerHTML = '';
            this.currentTranscriptItems = [];

            parsed.forEach((item, index) => {
                if (!item || typeof item !== 'object') return;

                const transcriptItem = document.createElement('div');
                transcriptItem.className = 'transcript-item';

                const timeEl = document.createElement('div');
                timeEl.className = 'transcript-item-time';
                timeEl.textContent = `${item.start ?? '00:00:00'} ~ ${item.end ?? '00:00:00'}`;

                const textEl = document.createElement('div');
                textEl.className = 'transcript-item-text';
                textEl.textContent = item.text || '';

                transcriptItem.appendChild(timeEl);
                transcriptItem.appendChild(textEl);
                transcriptItem.dataset.index = String(index);

                this.transcriptContent.appendChild(transcriptItem);
                this.currentTranscriptItems.push({
                    start: item.start ?? '00:00:00',
                    end: item.end ?? '00:00:00',
                    text: item.text || ''
                });
            });

            this.renderOriginalSubtitles(parsed);
            return;
        }

        this.transcriptContent.innerHTML = '';
        const pre = document.createElement('pre');
        pre.className = 'transcript-raw';
        pre.textContent = transcriptText.trim();
        this.transcriptContent.appendChild(pre);
        this.currentTranscriptItems = [];
        this.renderOriginalSubtitles(null);
    }

    getLanguageOptions() {
        const sourceValue = this.sourceLanguageSelect?.value ?? 'auto';
        const targetValue = this.targetLanguageSelect?.value ?? 'ko';

        const allowedSource = ['auto', 'en', 'es', 'ja', 'ko'];
        const allowedTarget = ['en', 'es', 'ja', 'ko'];

        const sourceLanguage = allowedSource.includes(sourceValue) ? sourceValue : 'auto';
        const targetLanguage = allowedTarget.includes(targetValue) ? targetValue : 'ko';

        return { sourceLanguage, targetLanguage };
    }

    async generateTranscript(transcriptSource, languageOptions = this.getLanguageOptions()) {
        if (!this.transcriptSection || !this.transcriptContent) {
            return false;
        }

        if (!transcriptSource) {
            this.resetTranscript();
            return false;
        }

        this.prepareTtsSegments([]);
        this.transcriptRequestId += 1;
        const currentRequestId = this.transcriptRequestId;
        this.lastTranscriptSource = transcriptSource;
        this.lastTranscriptLanguageOptions = languageOptions;

        this.transcriptSection.style.display = 'block';
        this.setTranscriptStatus('');
        this.renderTranscriptMessage('transcript-empty', '스크립트를 생성하는 중입니다...');

        try {
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    transcriptSource,
                    languageOptions
                })
            });

            let data = {};
            try {
                data = await response.json();
            } catch (_) {
                data = {};
            }

            if (currentRequestId !== this.transcriptRequestId) {
                return false;
            }

            if (!response.ok) {
                throw new Error(data.error || '스크립트를 생성하는 중 오류가 발생했습니다.');
            }

            const transcriptText = typeof data.transcript === 'string' ? data.transcript : '';
            const parsedItems = Array.isArray(data.items) ? data.items : null;
            const ttsSegments = Array.isArray(data.ttsSegments) ? data.ttsSegments : [];

            if (data.languageOptions) {
                this.lastTranscriptLanguageOptions = data.languageOptions;
                if (this.sourceLanguageSelect && data.languageOptions.sourceLanguage) {
                    this.sourceLanguageSelect.value = data.languageOptions.sourceLanguage;
                }
                if (this.targetLanguageSelect && data.languageOptions.targetLanguage) {
                    this.targetLanguageSelect.value = data.languageOptions.targetLanguage;
                }
            }

            if (data.ttsConfig && typeof data.ttsConfig.speakingRate === 'number') {
                this.ttsSpeakingRate = data.ttsConfig.speakingRate;
            } else {
                this.ttsSpeakingRate = 1;
            }

            if (ttsSegments.length > 0) {
                this.setTranscriptStatus('TTS를 준비하고 있습니다...');
            } else {
                this.renderTranscriptMessage('transcript-empty', '생성된 TTS가 없습니다.');
            }

            this.prepareTtsSegments(ttsSegments);
            this.renderTranscript(transcriptText, parsedItems);
            this.setTranscriptStatus('');
            this.updateVideoAudioMode();
            if (this.isVideoPlaying) {
                this.syncTtsWithVideo();
            }
            return true;
        } catch (error) {
            if (currentRequestId !== this.transcriptRequestId) {
                return false;
            }

            console.error('스크립트 생성 오류:', error);
            this.setTranscriptStatus('');
            this.prepareTtsSegments([]);
            this.updateVideoAudioMode();
            this.renderTranscriptMessage('transcript-error', error.message || '스크립트를 생성하지 못했습니다.');
            return false;
        }
    }

    prepareTtsSegments(segments = []) {
        this.stopAllTtsAudio();
        this.activeTtsIndex = -1;

        if (!Array.isArray(segments) || segments.length === 0) {
            this.ttsSegments = [];
            this.updateVideoAudioMode();
            return;
        }

        const sanitizedSegments = [];

        segments.forEach((segment) => {
            if (!segment || typeof segment !== 'object') {
                return;
            }

            const text = (segment.text ?? '').toString().trim();
            const audioContent = segment.audioContent;
            const providedAudioUrl = segment.audioUrl;
            if (!text || (!audioContent && !providedAudioUrl)) {
                return;
            }

            const startSeconds = this.timeStringToSeconds(
                segment.start ?? segment.startSeconds
            );
            const endSeconds = this.timeStringToSeconds(
                segment.end ?? segment.endSeconds
            );

            if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
                return;
            }

            const safeStart = Math.max(0, startSeconds);
            const safeEnd = endSeconds > safeStart ? endSeconds : safeStart + 0.4;
            const mimeType = segment.audioMimeType || 'audio/mp3';
            const dataUrl = audioContent
                ? `data:${mimeType};base64,${audioContent}`
                : providedAudioUrl;

            if (!dataUrl) {
                return;
            }

            const audio = new Audio(dataUrl);
            audio.preload = 'auto';

            sanitizedSegments.push({
                startSeconds: safeStart,
                endSeconds: safeEnd,
                text,
                audio,
                audioUrl: dataUrl,
                mimeType,
                hasPlayed: false
            });
        });

        sanitizedSegments.sort((a, b) => a.startSeconds - b.startSeconds);

        sanitizedSegments.forEach((segment, index) => {
            segment.audio.addEventListener('ended', () => {
                if (this.activeTtsIndex === index) {
                    this.activeTtsIndex = -1;
                    if (this.isVideoPlaying) {
                        this.syncTtsWithVideo();
                    }
                }
            });
        });

        this.ttsSegments = sanitizedSegments;
        this.activeTtsIndex = -1;
        this.updateVideoAudioMode();
        this.syncTtsPlaybackRate();
    }

    setOriginalVideoSource(url) {
        if (!this.originalVideoPlayer || !this.originalVideoWrapper) {
            return;
        }

        if (!url) {
            try {
                this.originalVideoPlayer.pause();
            } catch (_) {
                // ignore
            }
            this.originalVideoPlayer.removeAttribute('src');
            this.originalVideoPlayer.load();
            this.originalVideoWrapper.style.display = 'none';
            this.renderOriginalSubtitles(null);
            return;
        }

        try {
            this.originalVideoPlayer.pause();
        } catch (_) {
            // ignore
        }
        this.originalVideoPlayer.src = url;
        this.originalVideoPlayer.load();
        this.originalVideoWrapper.style.display = 'flex';
        this.syncOriginalSubtitles(true);
    }

    renderOriginalSubtitles(items) {
        if (!this.originalSubtitleList) {
            return;
        }

        this.originalSubtitleList.innerHTML = '';

        if (!Array.isArray(items) || items.length === 0) {
            this.originalSubtitleList.style.display = 'none';
            this.originalSubtitleEntries = [];
            this.lastOriginalSubtitleIndex = -1;
            return;
        }

        this.originalSubtitleList.style.display = 'flex';
        this.originalSubtitleEntries = [];
        this.lastOriginalSubtitleIndex = -1;

        items.forEach((item) => {
            if (!item || typeof item !== 'object') {
                return;
            }

            const subtitleItem = document.createElement('div');
            subtitleItem.className = 'original-subtitle-item';

            const textEl = document.createElement('div');
            textEl.className = 'original-subtitle-text';
            textEl.textContent = item.text || '';

            subtitleItem.appendChild(textEl);

            this.originalSubtitleList.appendChild(subtitleItem);

            const startSeconds = this.timeStringToSeconds(item.start ?? 0);
            const endSecondsRaw = this.timeStringToSeconds(item.end ?? item.start ?? 0);
            const safeStart = Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0;
            const safeEnd = Number.isFinite(endSecondsRaw) && endSecondsRaw > safeStart
                ? endSecondsRaw
                : safeStart + 0.4;

            subtitleItem.style.display = 'none';

            this.originalSubtitleEntries.push({
                element: subtitleItem,
                startSeconds: safeStart,
                endSeconds: safeEnd
            });
        });

        this.syncOriginalSubtitles(true);
    }

    updateVideoAudioMode() {
        if (!this.videoPlayer) {
            return;
        }

        if (this.ttsSegments.length > 0) {
            this.videoPlayer.muted = true;
            this.videoPlayer.volume = 0;
        } else {
            this.videoPlayer.muted = false;
            this.videoPlayer.volume = 1;
        }
    }

    syncTtsPlaybackRate() {
        if (!this.videoPlayer || !Array.isArray(this.ttsSegments)) {
            return;
        }

        const rate = Number.isFinite(this.videoPlayer.playbackRate)
            ? this.videoPlayer.playbackRate
            : 1;
        const effectiveRate = rate * (this.ttsSpeakingRate || 1);

        this.ttsSegments.forEach((segment) => {
            if (segment?.audio) {
                segment.audio.playbackRate = effectiveRate;
            }
        });
    }

    syncTtsWithVideo() {
        if (!this.videoPlayer || !this.ttsSegments.length) {
            this.stopCurrentTts();
            this.lastVideoTime = this.videoPlayer?.currentTime ?? this.lastVideoTime;
            return;
        }

        const currentTime = Number.isFinite(this.videoPlayer.currentTime)
            ? this.videoPlayer.currentTime
            : 0;
        const tolerance = 0.1;

        const rewound = currentTime + tolerance < this.lastVideoTime;
        const jumpedForward = currentTime - tolerance > this.lastVideoTime + tolerance;

        if (rewound) {
            this.ttsSegments.forEach((segment) => {
                if (segment.startSeconds + tolerance >= currentTime) {
                    segment.hasPlayed = false;
                }
            });
        } else if (jumpedForward) {
            this.ttsSegments.forEach((segment) => {
                if (segment.endSeconds + tolerance < currentTime) {
                    segment.hasPlayed = true;
                }
            });
        }

        if (!this.isVideoPlaying) {
            this.pauseCurrentTts();
            this.lastVideoTime = currentTime;
            return;
        }

        let nextIndex = this.activeTtsIndex;

        if (this.activeTtsIndex === -1) {
            nextIndex = this.ttsSegments.findIndex((segment) => {
                if (segment.hasPlayed) {
                    return false;
                }
                const windowStart = segment.startSeconds - tolerance;
                const windowEnd = segment.endSeconds + tolerance;
                return currentTime >= windowStart && currentTime < windowEnd;
            });
        }

        if (nextIndex === -1) {
            this.stopCurrentTts();
            this.lastVideoTime = currentTime;
            return;
        }

        const segment = this.ttsSegments[nextIndex];

        if (!segment?.audio) {
            this.lastVideoTime = currentTime;
            return;
        }

        if (this.activeTtsIndex !== nextIndex) {
            this.stopCurrentTts();
            segment.audio.currentTime = 0;
            segment.hasPlayed = true;
            this.activeTtsIndex = nextIndex;
            segment.audio
                .play()
                .catch((error) => {
                    console.warn('TTS 재생 실패:', error);
                    segment.hasPlayed = false;
                    this.activeTtsIndex = -1;
                });
        } else if (segment.audio.paused) {
            segment.audio.play().catch(() => {});
        }

        this.lastVideoTime = currentTime;
    }

    syncOriginalSubtitles(forceSeek = false) {
        if (
            !this.originalVideoPlayer ||
            !Array.isArray(this.originalSubtitleEntries) ||
            this.originalSubtitleEntries.length === 0
        ) {
            return;
        }

        const currentTime = Number.isFinite(this.originalVideoPlayer.currentTime)
            ? this.originalVideoPlayer.currentTime
            : 0;
        const tolerance = 0.12;
        let activeIndex = -1;

        this.originalSubtitleEntries.forEach((entry, index) => {
            const isActive =
                currentTime >= entry.startSeconds - tolerance &&
                currentTime < entry.endSeconds + tolerance;

            if (isActive) {
                entry.element.classList.add('active');
                entry.element.style.display = 'grid';
                if (activeIndex === -1) {
                    activeIndex = index;
                }
            } else {
                entry.element.classList.remove('active');
                entry.element.style.display = 'none';
            }
        });

        if (activeIndex === -1 && forceSeek) {
            const nextIndex = this.originalSubtitleEntries.findIndex(
                (entry) => entry.startSeconds >= currentTime
            );
            if (nextIndex !== -1) {
                const entry = this.originalSubtitleEntries[nextIndex];
                entry.element.classList.add('active');
                entry.element.style.display = 'grid';
                activeIndex = nextIndex;
            }
        }

        if (activeIndex !== -1 && activeIndex !== this.lastOriginalSubtitleIndex) {
            this.lastOriginalSubtitleIndex = activeIndex;
            try {
                this.originalSubtitleEntries[activeIndex].element.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                });
            } catch (_) {
                // ignore
            }
        } else if (activeIndex === -1) {
            this.lastOriginalSubtitleIndex = -1;
        }
    }

    pauseCurrentTts() {
        const segment = this.ttsSegments[this.activeTtsIndex];
        if (segment?.audio && !segment.audio.paused) {
            segment.audio.pause();
        }
    }

    stopCurrentTts() {
        const segment = this.ttsSegments[this.activeTtsIndex];
        if (segment?.audio) {
            segment.audio.pause();
            segment.audio.currentTime = 0;
        }
        this.activeTtsIndex = -1;
    }

    stopAllTtsAudio() {
        if (!Array.isArray(this.ttsSegments)) {
            return;
        }

        this.ttsSegments.forEach((segment) => {
            if (segment?.audio) {
                segment.audio.pause();
                try {
                    segment.audio.currentTime = 0;
                } catch (error) {
                    // 일부 브라우저에서 currentTime 리셋 중 오류가 발생할 수 있으므로 무시
                }
            }
        });
        this.activeTtsIndex = -1;
    }

    handleVideoPlay() {
        this.isVideoPlaying = true;
        this.syncTtsPlaybackRate();
        if (this.ttsSegments.length === 0) {
            return;
        }
        this.syncTtsWithVideo();
    }

    handleVideoPause() {
        this.isVideoPlaying = false;
        this.pauseCurrentTts();
    }

    handleVideoSeeked() {
        if (!this.videoPlayer) {
            return;
        }

        this.stopCurrentTts();
        this.ttsSegments.forEach((segment) => {
            if (segment?.audio) {
                segment.audio.pause();
                segment.audio.currentTime = 0;
            }
        });

        if (this.isVideoPlaying) {
            this.syncTtsWithVideo();
        }
    }

    handleVideoEnded() {
        this.isVideoPlaying = false;
        this.stopAllTtsAudio();
    }

    async handleLanguageOptionChange() {
        if (!this.lastTranscriptSource) {
            return;
        }

        const languageOptions = this.getLanguageOptions();
        const previous = this.lastTranscriptLanguageOptions;

        const hasChanged =
            !previous ||
            previous.sourceLanguage !== languageOptions.sourceLanguage ||
            previous.targetLanguage !== languageOptions.targetLanguage;

        if (hasChanged) {
            if (this.videoPlayer && !this.videoPlayer.paused) {
                this.videoPlayer.pause();
            }
            await this.generateTranscript(this.lastTranscriptSource, languageOptions);
        }
    }

    formatDuration(seconds) {
        if (!seconds) return '시간 정보 없음';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }

    formatFileSize(bytes) {
        if (!bytes) return '크기 정보 없음';
        
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    timeStringToSeconds(value) {
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

    setLoading(isLoading, buttonType = 'download') {
        if (buttonType === 'download') {
            const btnText = this.downloadBtn.querySelector('.btn-text');
            const loadingSpinner = this.downloadBtn.querySelector('.loading-spinner');
            
            this.downloadBtn.disabled = isLoading;
            
            if (isLoading) {
                btnText.style.display = 'none';
                loadingSpinner.style.display = 'block';
            } else {
                btnText.style.display = 'block';
                loadingSpinner.style.display = 'none';
            }
        } else if (buttonType === 'pasteDownload') {
            const btnText = this.pasteDownloadBtn.querySelector('.btn-text');
            const loadingSpinner = this.pasteDownloadBtn.querySelector('.loading-spinner');
            
            this.pasteDownloadBtn.disabled = isLoading;
            
            if (isLoading) {
                btnText.style.display = 'none';
                loadingSpinner.style.display = 'block';
            } else {
                btnText.style.display = 'block';
                loadingSpinner.style.display = 'none';
            }
        } else if (buttonType === 'upload' && this.uploadBtn) {
            const btnText = this.uploadBtn.querySelector('.btn-text');
            const loadingSpinner = this.uploadBtn.querySelector('.loading-spinner');

            this.uploadBtn.disabled = isLoading;

            if (isLoading) {
                btnText.style.display = 'none';
                loadingSpinner.style.display = 'block';
            } else {
                btnText.style.display = 'block';
                loadingSpinner.style.display = 'none';
            }
        }
    }

    showResult() {
        this.resultSection.style.display = 'block';
    }

    hideResult() {
        this.resultSection.style.display = 'none';
        this.resetVideoPlayer();
        this.resetTranscript();
    }

    showError(message) {
        this.errorSection.textContent = message;
        this.errorSection.style.display = 'block';
        
        // 5초 후 자동으로 에러 메시지 숨기기
        setTimeout(() => {
            this.hideError();
        }, 5000);
    }

    hideError() {
        this.errorSection.style.display = 'none';
    }

    async handlePasteAndDownload() {
        try {
            // 먼저 붙여넣기 시도
            const text = await navigator.clipboard.readText();
            if (text) {
                this.urlInput.value = text;
                this.hideError();
                
                // 붙여넣기 성공 후 다운로드 실행
                await this.handleDownload('pasteDownload');
            } else {
                this.showError('클립보드에 링크가 없습니다.');
            }
        } catch (error) {
            console.error('붙여넣기 실패:', error);
            this.showError('클립보드 접근에 실패했습니다. 수동으로 링크를 붙여넣어주세요.');
        }
    }

}

// 페이지 로드 후 초기화
document.addEventListener('DOMContentLoaded', () => {
    new ClipHive();
}); 