class MorseDecoder {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.startBtn = document.getElementById('startBtn');
        this.detectBtn = document.getElementById('detectBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.status = document.getElementById('status');
        this.morseOutput = document.getElementById('morseOutput');
        this.textOutput = document.getElementById('textOutput');
        this.cameraInfo = document.getElementById('cameraInfo');
        this.thresholdInfo = document.getElementById('thresholdInfo');
        
        this.isDetecting = false;
        this.stream = null;
        this.animationFrame = null;
        this.lightStates = [];
        this.lastBrightness = 0;
        this.stateStartTime = 0;
        this.currentMorse = '';
        this.detectedSignals = [];
        this.currentLetter = '';
        this.realtimeMorse = '';
        this.lastUpdateTime = 0;
        this.processingBuffer = [];
        this.frameCount = 0;
        this.lastFpsTime = Date.now();
        this.currentFps = 0;
        this.maxLightStates = 200;
        this.frameSkipCounter = 0;
        this.frameSkipInterval = 1;
        this.worker = null;
        this.messageQueue = [];
        this.pendingMessages = new Map();
        this.messageId = 0;
        this.initWorker();
        
        this.morseTable = {
            '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E',
            '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I', '.---': 'J',
            '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O',
            '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T',
            '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y',
            '--..': 'Z', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
            '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
            '-----': '0', '--..--': ',', '.-.-.-': '.', '..--..': '?', '-.-.--': '!',
            '-....-': '-', '-..-.': '/', '.--.-.': '@', '-.--.': '(', '-.--.-': ')'
        };
        
        this.init();
    }
    
    initWorker() {
        try {
            this.worker = new Worker('detection-worker.js');
            this.worker.onmessage = (e) => {
                const { type, data, messageId } = e.data;
                
                // 移除待处理消息
                if (messageId && this.pendingMessages.has(messageId)) {
                    this.pendingMessages.delete(messageId);
                }
                
                switch (type) {
                    case 'BRIGHTNESS_RESULT':
                        this.handleBrightnessResult(data);
                        break;
                    case 'SIGNAL_RESULT':
                        this.handleSignalResult(data);
                        break;
                    case 'RESULTS_CLEARED':
                        break;
                    default:
                        console.warn('Unknown worker response:', type);
                }
                
                // 处理队列中的下一条消息
                this.processMessageQueue();
            };
            
            this.worker.onerror = (error) => {
                console.error('Worker error:', error);
                this.pendingMessages.clear();
                this.messageQueue = [];
            };
        } catch (error) {
            console.warn('Web Workers not supported, falling back to main thread');
            this.worker = null;
        }
    }
    
    init() {
        this.startBtn.addEventListener('click', () => this.toggleCamera());
        this.detectBtn.addEventListener('click', () => this.toggleDetection());
        this.clearBtn.addEventListener('click', () => this.clearResults());
        
        document.getElementById('exposureTime').addEventListener('change', () => {
            if (this.stream) {
                this.restartCamera();
            }
        });
        
        document.getElementById('focusDistance').addEventListener('change', () => {
            if (this.stream) {
                this.restartCamera();
            }
        });
        
        document.getElementById('autoThreshold').addEventListener('change', (e) => {
            const enabled = e.target.checked;
            document.getElementById('threshold').disabled = enabled;
            if (this.worker) {
                this.sendToWorker('SET_AUTO_THRESHOLD', { enabled: enabled });
            }
        });
        
        document.getElementById('thresholdOffset').addEventListener('input', (e) => {
            const offset = parseInt(e.target.value);
            document.getElementById('offsetValue').textContent = offset;
            if (this.worker) {
                this.sendToWorker('SET_THRESHOLD_OFFSET', { offset: offset });
            }
        });
        
        window.addEventListener('beforeunload', () => this.cleanup());
    }
    
    async startCamera() {
        try {
            this.startBtn.disabled = true;
            this.status.textContent = '正在启动摄像头...';
            
            const exposureTime = parseInt(document.getElementById('exposureTime').value);
            const focusDistance = parseInt(document.getElementById('focusDistance').value) / 100;
            
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 320, max: 480 },
                    height: { ideal: 240, max: 360 },
                    advanced: [{
                        exposureMode: { exact: 'manual' },
                        exposureTime: { ideal: exposureTime },
                        focusMode: { exact: 'manual' },
                        focusDistance: { ideal: focusDistance },
                        whiteBalanceMode: { exact: 'manual' }
                    }]
                },
                audio: false
            };
            
            try {
                this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                console.log('Failed to get back camera, trying front camera:', err);
                const frontConstraints = {
                    video: {
                        facingMode: 'user',
                        width: { ideal: 320, max: 480 },
                        height: { ideal: 240, max: 360 },
                        advanced: [{
                            exposureMode: { exact: 'manual' },
                            exposureTime: { ideal: exposureTime },
                            focusMode: { exact: 'manual' },
                            focusDistance: { ideal: focusDistance },
                            whiteBalanceMode: { exact: 'manual' }
                        }]
                    },
                    audio: false
                };
                this.stream = await navigator.mediaDevices.getUserMedia(frontConstraints);
            }
            
            this.video.srcObject = this.stream;
            
            await new Promise((resolve) => {
                this.video.onloadedmetadata = resolve;
            });
            
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            
            this.updateCameraInfo();
            this.status.textContent = `摄像头已就绪，可以开始检测`;
            this.startBtn.textContent = '关闭摄像头';
            this.startBtn.disabled = false;
            this.detectBtn.disabled = false;
            
        } catch (err) {
            console.error('Camera error:', err);
            this.status.textContent = `摄像头启动失败: ${err.message}`;
            this.startBtn.disabled = false;
        }
    }
    
    stopCamera() {
        if (this.isDetecting) {
            this.stopDetection();
        }
        
        // 停止所有媒体轨道
        if (this.stream) {
            this.stream.getTracks().forEach(track => {
                track.stop();
                console.log('Stopped track:', track.kind, track.readyState);
            });
            this.stream = null;
        }
        
        // 清除视频源并强制刷新
        this.video.srcObject = null;
        this.video.load(); // 强制重新加载视频元素
        
        // 清除canvas内容
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        this.status.textContent = '摄像头已关闭';
        this.startBtn.textContent = '开启摄像头';
        this.detectBtn.disabled = true;
        
        // 清除摄像头信息显示
        if (this.cameraInfo) {
            this.cameraInfo.textContent = '分辨率: - | 帧率: - FPS';
        }
        if (this.thresholdInfo) {
            this.thresholdInfo.textContent = '阈值: - | 亮度范围: -';
        }
    }
    
    toggleDetection() {
        if (this.isDetecting) {
            this.stopDetection();
        } else {
            this.startDetection();
        }
    }
    
    startDetection() {
        this.isDetecting = true;
        this.detectBtn.textContent = '停止检测';
        this.status.textContent = '正在检测LED闪烁...';
        this.status.classList.add('active');
        this.lightStates = [];
        this.currentLetter = '';
        this.realtimeMorse = '';
        this.processingBuffer = [];
        this.lastUpdateTime = Date.now();
        this.stateStartTime = Date.now();
        this.frameCount = 0;
        this.lastFpsTime = Date.now();
        this.frameSkipCounter = 0;
        
        document.getElementById('threshold').disabled = document.getElementById('autoThreshold').checked;
        this.detectLED();
    }
    
    stopDetection() {
        this.isDetecting = false;
        this.detectBtn.textContent = '开始检测';
        this.status.textContent = '检测已停止';
        this.status.classList.remove('active');
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        this.processDetectedSignals();
    }
    
    detectLED() {
        if (!this.isDetecting) return;
        
        this.frameSkipCounter++;
        if (this.frameSkipCounter < this.frameSkipInterval) {
            this.animationFrame = requestAnimationFrame(() => this.detectLED());
            return;
        }
        this.frameSkipCounter = 0;
        
        // 限制待处理消息数量，避免积压
        if (this.pendingMessages.size > 5) {
            this.animationFrame = requestAnimationFrame(() => this.detectLED());
            return;
        }
        
        const centerX = Math.floor(this.canvas.width / 2);
        const centerY = Math.floor(this.canvas.height / 2);
        const radius = Math.min(parseInt(document.getElementById('sensitivity').value), 15);
        const threshold = parseInt(document.getElementById('threshold').value);
        
        this.ctx.drawImage(this.video, centerX - radius, centerY - radius, radius * 2, radius * 2, 0, 0, radius * 2, radius * 2);
        const imageData = this.ctx.getImageData(0, 0, radius * 2, radius * 2);
        
        if (this.worker) {
            const autoThreshold = document.getElementById('autoThreshold').checked;
            this.sendToWorker('CALCULATE_BRIGHTNESS', {
                imageData: imageData,
                threshold: threshold,
                autoThreshold: autoThreshold
            });
        } else {
            this.fallbackDetection(imageData, threshold);
        }
        
        this.animationFrame = requestAnimationFrame(() => this.detectLED());
    }
    
    fallbackDetection(imageData, threshold) {
        const data = imageData.data;
        let totalBrightness = 0;
        let pixelCount = 0;
        
        const step = 3;
        for (let i = 0; i < data.length; i += 4 * step) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            totalBrightness += (r + g + b);
            pixelCount++;
        }
        
        const avgBrightness = totalBrightness / (pixelCount * 3);
        const isLightOn = avgBrightness > threshold;
        
        this.handleBrightnessResult({
            brightness: Math.round(avgBrightness),
            isLightOn: isLightOn
        });
    }
    
    handleBrightnessResult(result) {
        const { brightness, isLightOn, adaptiveThreshold, historyStats } = result;
        const currentTime = Date.now();
        
        if (adaptiveThreshold !== undefined) {
            this.updateThresholdInfo(adaptiveThreshold, historyStats);
        }
        
        if (this.lightStates.length === 0) {
            this.lightStates.push({ state: isLightOn, startTime: currentTime });
        } else {
            const lastState = this.lightStates[this.lightStates.length - 1];
            if (lastState.state !== isLightOn) {
                lastState.duration = currentTime - lastState.startTime;
                this.lightStates.push({ state: isLightOn, startTime: currentTime });
                
                if (this.lightStates.length > this.maxLightStates) {
                    this.cleanupLightStatesMain();
                }
                
                if (this.worker) {
                    const dotLength = parseInt(document.getElementById('dotLength').value);
                    this.sendToWorker('PROCESS_SIGNAL', {
                        isLightOn: isLightOn,
                        currentTime: currentTime,
                        dotLength: dotLength
                    });
                } else {
                    this.processRealtimeSignals();
                }
            }
        }
        
        this.frameCount++;
        const now = Date.now();
        if (now - this.lastFpsTime >= 2000) {
            this.currentFps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime));
            this.frameCount = 0;
            this.lastFpsTime = now;
            this.updateCameraInfo();
        }
        
        if (this.frameCount % 10 === 0) {
            this.status.textContent = `检测中... 亮度: ${brightness} (${isLightOn ? '亮' : '暗'})`;
        }
    }
    
    handleSignalResult(result) {
        const { morse, text } = result;
        this.morseOutput.textContent = morse;
        this.textOutput.textContent = text;
    }
    
    processRealtimeSignals() {
        if (this.lightStates.length < 2) return;
        
        const dotLength = parseInt(document.getElementById('dotLength').value);
        const dashThreshold = dotLength * 2.5;
        const pauseThreshold = dotLength * 1.5;
        const wordPauseThreshold = dotLength * 6;
        
        const lastState = this.lightStates[this.lightStates.length - 2];
        
        if (lastState.state && lastState.duration) {
            if (lastState.duration >= dashThreshold) {
                this.currentLetter += '-';
            } else if (lastState.duration >= dotLength * 0.5) {
                this.currentLetter += '.';
            }
        } else if (!lastState.state && lastState.duration) {
            if (lastState.duration >= wordPauseThreshold) {
                if (this.currentLetter) {
                    this.realtimeMorse += this.currentLetter + ' ';
                    this.currentLetter = '';
                }
                this.realtimeMorse += '/ ';
            } else if (lastState.duration >= pauseThreshold) {
                if (this.currentLetter) {
                    this.realtimeMorse += this.currentLetter + ' ';
                    this.currentLetter = '';
                }
            }
        }
        
        let displayMorse = this.realtimeMorse;
        if (this.currentLetter) {
            displayMorse += this.currentLetter;
        }
        
        this.morseOutput.textContent = displayMorse || '等待信号...';
        this.translateRealtimeMorseCode(displayMorse);
    }
    
    processDetectedSignals() {
        if (this.lightStates.length === 0) return;
        
        const dotLength = parseInt(document.getElementById('dotLength').value);
        const dashThreshold = dotLength * 2.5;
        const pauseThreshold = dotLength * 1.5;
        const wordPauseThreshold = dotLength * 6;
        
        let morseCode = '';
        let currentLetter = '';
        
        for (let i = 0; i < this.lightStates.length - 1; i++) {
            const state = this.lightStates[i];
            
            if (state.state && state.duration) {
                if (state.duration >= dashThreshold) {
                    currentLetter += '-';
                } else if (state.duration >= dotLength * 0.5) {
                    currentLetter += '.';
                }
            } else if (!state.state && state.duration) {
                if (state.duration >= wordPauseThreshold) {
                    if (currentLetter) {
                        morseCode += currentLetter + ' ';
                        currentLetter = '';
                    }
                    morseCode += '/ ';
                } else if (state.duration >= pauseThreshold) {
                    if (currentLetter) {
                        morseCode += currentLetter + ' ';
                        currentLetter = '';
                    }
                }
            }
        }
        
        if (currentLetter) {
            morseCode += currentLetter;
        }
        
        this.currentMorse = morseCode.trim();
        this.morseOutput.textContent = this.currentMorse || '未检测到有效信号';
        this.translateMorseCode();
    }
    
    translateRealtimeMorseCode(morseCode) {
        if (!morseCode) {
            this.textOutput.textContent = '等待解码...';
            return;
        }
        
        const words = morseCode.split(' / ');
        const translatedWords = words.map(word => {
            const letters = word.split(' ').filter(letter => letter.length > 0);
            return letters.map(letter => this.morseTable[letter] || '?').join('');
        });
        
        this.textOutput.textContent = translatedWords.join(' ');
    }
    
    translateMorseCode() {
        if (!this.currentMorse) {
            this.textOutput.textContent = '';
            return;
        }
        
        const words = this.currentMorse.split(' / ');
        const translatedWords = words.map(word => {
            const letters = word.split(' ').filter(letter => letter.length > 0);
            return letters.map(letter => this.morseTable[letter] || '?').join('');
        });
        
        this.textOutput.textContent = translatedWords.join(' ');
    }
    
    clearResults() {
        this.currentMorse = '';
        this.detectedSignals = [];
        this.lightStates = [];
        this.currentLetter = '';
        this.realtimeMorse = '';
        this.processingBuffer = [];
        this.frameCount = 0;
        this.lastFpsTime = Date.now();
        this.currentFps = 0;
        
        if (this.worker) {
            this.sendToWorker('CLEAR_RESULTS', {});
        }
        
        this.morseOutput.textContent = '莫斯电码将显示在这里';
        this.textOutput.textContent = '解码文本将显示在这里';
    }
    
    async restartCamera() {
        if (this.isDetecting) {
            this.stopDetection();
        }
        this.stopCamera();
        await this.startCamera();
    }
    
    updateCameraInfo() {
        if (this.cameraInfo && this.video.videoWidth) {
            const exposureTime = document.getElementById('exposureTime').value;
            const focusDistance = document.getElementById('focusDistance').value;
            this.cameraInfo.textContent = `分辨率: ${this.video.videoWidth}x${this.video.videoHeight} | 帧率: ${this.currentFps} FPS | 曝光: ${exposureTime}μs | 对焦: ${focusDistance}%`;
        }
    }
    
    updateThresholdInfo(adaptiveThreshold, stats) {
        if (this.thresholdInfo) {
            const autoMode = document.getElementById('autoThreshold').checked;
            const currentThreshold = autoMode ? adaptiveThreshold : document.getElementById('threshold').value;
            const range = stats ? `${stats.min}-${stats.max} (平均${stats.avg})` : '-';
            const mode = autoMode ? '自适应' : '手动';
            this.thresholdInfo.textContent = `阈值: ${currentThreshold} (${mode}) | 亮度范围: ${range}`;
        }
    }
    
    sendToWorker(type, data) {
        if (!this.worker) return;
        
        const messageId = ++this.messageId;
        const message = { type, data, messageId };
        
        // 对于高频消息（亮度计算），直接发送，但限制待处理数量
        if (type === 'CALCULATE_BRIGHTNESS') {
            if (this.pendingMessages.size < 3) {
                this.pendingMessages.set(messageId, message);
                this.worker.postMessage(message);
            }
            // 超出限制则丢弃该帧，保持实时性
            return;
        }
        
        // 其他消息加入队列
        this.messageQueue.push(message);
        this.processMessageQueue();
    }
    
    processMessageQueue() {
        if (this.messageQueue.length === 0 || !this.worker) return;
        
        // 一次处理一条非亮度计算消息
        const message = this.messageQueue.shift();
        this.pendingMessages.set(message.messageId, message);
        this.worker.postMessage(message);
    }
    
    toggleCamera() {
        if (this.stream) {
            this.stopCamera();
        } else {
            this.startCamera();
        }
    }
    
    cleanup() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.messageQueue = [];
        this.pendingMessages.clear();
        this.stopCamera();
    }
    
    cleanupLightStatesMain() {
        // 只清理过期的lightStates，保留莫斯电码结果
        const tenSecondsAgo = Date.now() - 10000;
        let cleanupIndex = 0;
        
        // 找到10秒前的数据位置
        for (let i = 0; i < this.lightStates.length - 1; i++) {
            if (this.lightStates[i].startTime > tenSecondsAgo) {
                cleanupIndex = i;
                break;
            }
        }
        
        // 清理过期数据
        if (cleanupIndex > 0) {
            this.lightStates = this.lightStates.slice(cleanupIndex);
        }
        
        // 如果仍然太大，保留最近的一半数据
        if (this.lightStates.length > this.maxLightStates) {
            const keepCount = Math.floor(this.maxLightStates / 2);
            this.lightStates = this.lightStates.slice(-keepCount);
            // 不清除 realtimeMorse 和 currentLetter
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        document.getElementById('status').textContent = '您的浏览器不支持摄像头功能';
        document.getElementById('startBtn').disabled = true;
        return;
    }
    
    new MorseDecoder();
});
