class MorseDecoder {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.startBtn = document.getElementById('startBtn');
        this.detectBtn = document.getElementById('detectBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.status = document.getElementById('status');
        this.morseOutput = document.getElementById('morseOutput');
        this.textOutput = document.getElementById('textOutput');
        this.cameraInfo = document.getElementById('cameraInfo');
        
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
    
    init() {
        this.startBtn.addEventListener('click', () => this.startCamera());
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
            this.startBtn.onclick = () => this.stopCamera();
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
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        this.video.srcObject = null;
        this.status.textContent = '摄像头已关闭';
        this.startBtn.textContent = '开启摄像头';
        this.startBtn.onclick = () => this.startCamera();
        this.detectBtn.disabled = true;
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
        
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        
        const centerX = Math.floor(this.canvas.width / 2);
        const centerY = Math.floor(this.canvas.height / 2);
        const radius = parseInt(document.getElementById('sensitivity').value);
        const threshold = parseInt(document.getElementById('threshold').value);
        
        let totalBrightness = 0;
        let pixelCount = 0;
        
        const step = 2;
        for (let x = centerX - radius; x <= centerX + radius; x += step) {
            for (let y = centerY - radius; y <= centerY + radius; y += step) {
                if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
                    const imageData = this.ctx.getImageData(x, y, 1, 1);
                    const [r, g, b] = imageData.data;
                    const brightness = (r + g + b) / 3;
                    totalBrightness += brightness;
                    pixelCount++;
                }
            }
        }
        
        const avgBrightness = totalBrightness / pixelCount;
        const isLightOn = avgBrightness > threshold;
        const currentTime = Date.now();
        
        if (this.lightStates.length === 0) {
            this.lightStates.push({ state: isLightOn, startTime: currentTime });
        } else {
            const lastState = this.lightStates[this.lightStates.length - 1];
            if (lastState.state !== isLightOn) {
                lastState.duration = currentTime - lastState.startTime;
                this.lightStates.push({ state: isLightOn, startTime: currentTime });
                this.processRealtimeSignals();
            }
        }
        
        this.frameCount++;
        const now = Date.now();
        if (now - this.lastFpsTime >= 1000) {
            this.currentFps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime));
            this.frameCount = 0;
            this.lastFpsTime = now;
            this.updateCameraInfo();
        }
        
        this.status.textContent = `检测中... 亮度: ${Math.round(avgBrightness)} (${isLightOn ? '亮' : '暗'})`;
        
        this.animationFrame = requestAnimationFrame(() => this.detectLED());
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
    
    cleanup() {
        this.stopCamera();
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
