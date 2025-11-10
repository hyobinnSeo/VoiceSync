class ClipHive {
    constructor() {
        this.urlInput = document.getElementById('urlInput');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.pasteDownloadBtn = document.getElementById('pasteDownloadBtn');
        this.resultSection = document.getElementById('result');
        this.errorSection = document.getElementById('error');
        
        // Result elements
        this.thumbnail = document.getElementById('thumbnail');
        this.videoTitle = document.getElementById('videoTitle');
        this.videoUploader = document.getElementById('videoUploader');
        this.videoDuration = document.getElementById('videoDuration');
        this.videoQuality = document.getElementById('videoQuality');
        this.fileSize = document.getElementById('fileSize');
        this.downloadStatus = document.getElementById('downloadStatus');
        
        // Audio option
        this.selectedAudioOption = 'auto';
        
        this.init();
    }

    init() {
        this.downloadBtn.addEventListener('click', () => this.handleDownload());
        this.pasteDownloadBtn.addEventListener('click', () => this.handlePasteAndDownload());
        
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleDownload();
            }
        });
        
        // URL 입력시 에러 메시지 숨기기
        this.urlInput.addEventListener('input', () => {
            this.hideError();
        });
        
        // 오디오 옵션 버튼 이벤트
        const optionBtns = document.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.handleAudioOption(btn.dataset.option);
            });
        });
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
        this.setDownloadStatus('영상 정보를 가져오는 중...', 'loading');

        try {
            console.log('다운로드 요청 시작:', url);
            
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

            // 영상 정보 표시
            this.displayVideoInfo(data);
            this.showResult();

            // 다운로드 시작 - TikTok도 자동 다운로드 시도
            const isTikTokUrl = url.includes('tiktok.com') || data.isTikTok;
            console.log('TikTok 체크:', { url, isTikTokUrl, dataIsTikTok: data.isTikTok });
            
            if (isTikTokUrl) {
                this.setDownloadStatus('TikTok 서버 다운로드를 시작합니다...', 'loading');
                
                try {
                    // TikTok 서버 다운로드 자동 시작
                    await this.startTikTokDownload(data.downloadUrl, data.filename, data.directUrl);
                } catch (downloadError) {
                    console.log('TikTok 자동 다운로드 실패, 대안 옵션 제공');
                    this.setDownloadStatus(`
                        <div style="text-align: left;">
                            <p><strong>⚠️ 자동 다운로드 실패 - 수동 옵션:</strong></p>
                            <div style="margin-top: 12px;">
                                <button onclick="window.location.href='${data.downloadUrl}'" style="background: #303e5c; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; margin-right: 8px; font-weight: 600;">다시 시도</button>
                                <button onclick="window.open('${data.directUrl}', '_blank')" style="background: #6b9bd1; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; margin-right: 8px;">직접 링크 열기</button>
                            </div>
                            <div style="margin-top: 8px;">
                                <button onclick="navigator.clipboard.writeText('${data.directUrl}').then(() => { this.textContent = '✅ 복사됨!'; setTimeout(() => this.textContent = '📋 링크 복사', 2000); })" style="background: none; border: 1px solid #8b9dc3; color: #8b9dc3; padding: 8px 12px; border-radius: 4px; cursor: pointer;">📋 링크 복사</button>
                            </div>
                                                         <div style="font-size: 0.85em; margin-top: 12px; padding: 8px; background: rgba(48, 62, 92, 0.1); border-radius: 4px; border-left: 3px solid #303e5c;">
                                <p style="margin: 0;"><strong>💡 대안 방법:</strong></p>
                                <p style="margin: 4px 0;">• <strong>다시 시도</strong>: 서버 다운로드 재시도</p>
                                <p style="margin: 4px 0;">• <strong>직접 링크</strong>: 새 탭에서 우클릭 → "다른 이름으로 저장"</p>
                            </div>
                        </div>
                    `, 'error');
                }
            } else {
                this.setDownloadStatus('다운로드를 시작합니다...', 'loading');
                await this.startDownload(data.downloadUrl, data.filename, data.directUrl);
            }

        } catch (error) {
            console.error('영상 정보 가져오기 오류:', error);
            this.showError(error.message);
            this.setDownloadStatus('영상 정보를 가져오는데 실패했습니다.', 'error');
        } finally {
            this.setLoading(false, buttonType);
        }
    }

    async startDownload(downloadUrl, filename, directUrl = null) {
        try {
            console.log('다운로드 시작:', { downloadUrl, filename });

            // 다운로드 링크 생성 및 클릭
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename;
            link.target = '_blank';
            
            // 링크를 DOM에 추가하고 클릭 후 제거
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            console.log('다운로드 링크 클릭 완료');
            this.setDownloadStatus('다운로드가 시작되었습니다! 🎉', 'success');
            
            // 5초 후 추가 옵션 제공
            setTimeout(() => {
                let statusHtml = '다운로드가 시작되지 않았나요?<br><div style="margin-top: 8px;">';
                
                // 프록시 링크 복사 버튼
                statusHtml += `<button onclick="navigator.clipboard.writeText('${downloadUrl}').then(() => this.textContent = '복사됨!')" style="background: none; border: 1px solid #6b9bd1; color: #6b9bd1; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-right: 8px;">프록시 링크 복사</button>`;
                
                // 직접 링크도 있으면 제공
                if (directUrl) {
                    statusHtml += `<button onclick="navigator.clipboard.writeText('${directUrl}').then(() => this.textContent = '복사됨!')" style="background: none; border: 1px solid #8b9dc3; color: #8b9dc3; padding: 4px 8px; border-radius: 4px; cursor: pointer;">직접 링크 복사</button>`;
                }
                
                statusHtml += '</div>';
                
                this.setDownloadStatus(statusHtml, 'info');
            }, 5000);

        } catch (error) {
            console.error('다운로드 시작 오류:', error);
            this.setDownloadStatus('다운로드 시작에 실패했습니다.', 'error');
            throw error;
        }
    }

    async startTikTokDownload(downloadUrl, filename, directUrl = null) {
        try {
            console.log('TikTok 서버 다운로드 시작:', { downloadUrl, filename });

            // YouTube와 동일한 <a> 태그 방식 사용
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename;
            link.target = '_blank';
            
            // 링크를 DOM에 추가하고 클릭 후 제거
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            console.log('TikTok 서버 다운로드 링크 클릭 완료');
            this.setDownloadStatus(`
                <div style="text-align: center;">
                    <p><strong>🎉 TikTok 다운로드 시작됨!</strong></p>
                    <p style="margin: 8px 0; color: #6b9bd1;">H.264 호환 포맷으로 서버에서 다운로드 중...</p>
                    <div style="margin-top: 12px;">
                        <button onclick="window.open('${downloadUrl}', '_blank')" style="background: #303e5c; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; margin-right: 8px;">다시 시도</button>
                        <button onclick="navigator.clipboard.writeText('${directUrl}').then(() => { this.textContent = '✅ 복사됨!'; setTimeout(() => this.textContent = '📋 백업 링크 복사', 2000); })" style="background: none; border: 1px solid #8b9dc3; color: #8b9dc3; padding: 8px 12px; border-radius: 4px; cursor: pointer;">📋 백업 링크 복사</button>
                    </div>
                </div>
            `, 'success');

        } catch (error) {
            console.error('TikTok 다운로드 시작 오류:', error);
            this.setDownloadStatus('TikTok 다운로드 시작에 실패했습니다.', 'error');
            throw error;
        }
    }

    displayVideoInfo(data) {
        this.thumbnail.src = data.thumbnail || '';
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
        }
    }

    setDownloadStatus(message, type = 'info') {
        this.downloadStatus.innerHTML = message;
        this.downloadStatus.className = `download-status ${type}`;
        this.downloadStatus.style.display = 'block';
    }

    showResult() {
        this.resultSection.style.display = 'block';
    }

    hideResult() {
        this.resultSection.style.display = 'none';
        if (this.downloadStatus) {
            this.downloadStatus.style.display = 'none';
        }
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