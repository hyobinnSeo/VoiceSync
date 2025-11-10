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
        
        if (this.videoPlayer) {
            this.videoPlayer.addEventListener('error', () => {
                this.showError('영상 재생 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            });
        }
        
        // Audio option
        this.selectedAudioOption = 'auto';
        
        this.init();
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
        
        // 오디오 옵션 버튼 이벤트
        const optionBtns = document.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.handleAudioOption(btn.dataset.option);
            });
        });
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
                    url, 
                    audioOption: this.selectedAudioOption 
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

    handleAudioOption(option) {
        // 기존 활성화된 버튼 비활성화
        document.querySelectorAll('.option-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // 선택된 버튼 활성화
        document.querySelector(`[data-option="${option}"]`).classList.add('active');
        
        // 선택된 옵션 저장
        this.selectedAudioOption = option;
        
        console.log('오디오 옵션 선택됨:', option);
    }
}

// 페이지 로드 후 초기화
document.addEventListener('DOMContentLoaded', () => {
    new ClipHive();
}); 