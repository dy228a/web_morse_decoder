class DetectionWorker {
    constructor() {
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
        
        this.lightStates = [];
        this.currentLetter = '';
        this.realtimeMorse = '';
        this.maxLightStates = 200;
        
        this.brightnessHistory = [];
        this.maxHistorySize = 100;
        this.adaptiveThreshold = 150;
        this.thresholdOffset = 0;
        this.autoThresholdEnabled = false;
    }
    
    calculateBrightness(imageData, threshold, autoThreshold) {
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
        
        this.updateBrightnessHistory(avgBrightness);
        
        let effectiveThreshold = threshold;
        if (autoThreshold) {
            effectiveThreshold = this.calculateAdaptiveThreshold();
        }
        
        const isLightOn = avgBrightness > effectiveThreshold;
        
        return {
            brightness: Math.round(avgBrightness),
            isLightOn: isLightOn,
            adaptiveThreshold: Math.round(effectiveThreshold),
            historyStats: this.getBrightnessStats()
        };
    }
    
    updateBrightnessHistory(brightness) {
        this.brightnessHistory.push({
            value: brightness,
            timestamp: Date.now()
        });
        
        if (this.brightnessHistory.length > this.maxHistorySize) {
            this.brightnessHistory.shift();
        }
        
        const fiveSecondsAgo = Date.now() - 5000;
        this.brightnessHistory = this.brightnessHistory.filter(entry => 
            entry.timestamp > fiveSecondsAgo
        );
    }
    
    calculateAdaptiveThreshold() {
        if (this.brightnessHistory.length < 5) {
            return this.adaptiveThreshold;
        }
        
        const values = this.brightnessHistory.map(entry => entry.value);
        values.sort((a, b) => a - b);
        
        const min = values[0];
        const max = values[values.length - 1];
        const range = max - min;
        
        let threshold = (max + min) / 2;
        
        // 确保阈值不会太接近最大值，至少保留20的余量
        if (threshold > max - 20) {
            threshold = max - 20;
        }
        
        // 确保阈值不会太接近最小值，至少高出15
        if (threshold < min + 15) {
            threshold = min + 15;
        }
        
        // 应用用户调整
        threshold += this.thresholdOffset;
        
        // 限制在合理范围内
        this.adaptiveThreshold = Math.max(50, Math.min(240, threshold));
        return this.adaptiveThreshold;
    }
    
    getBrightnessStats() {
        if (this.brightnessHistory.length === 0) {
            return { min: 0, max: 0, avg: 0, count: 0 };
        }
        
        const values = this.brightnessHistory.map(entry => entry.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
        
        return {
            min: Math.round(min),
            max: Math.round(max),
            avg: Math.round(avg),
            count: values.length
        };
    }
    
    processSignal(isLightOn, currentTime, dotLength) {
        const dashThreshold = dotLength * 2.5;
        const pauseThreshold = dotLength * 1.5;
        const wordPauseThreshold = dotLength * 6;
        
        if (this.lightStates.length === 0) {
            this.lightStates.push({ state: isLightOn, startTime: currentTime });
            return null;
        }
        
        const lastState = this.lightStates[this.lightStates.length - 1];
        if (lastState.state !== isLightOn) {
            lastState.duration = currentTime - lastState.startTime;
            this.lightStates.push({ state: isLightOn, startTime: currentTime });
            
            // 智能清理状态数组，保留莫斯电码结果
            if (this.lightStates.length > this.maxLightStates) {
                this.cleanupLightStates();
            }
            
            // 处理实时信号
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
            
            return {
                morse: displayMorse || '等待信号...',
                text: this.translateMorseCode(displayMorse)
            };
        }
        
        return null;
    }
    
    translateMorseCode(morseCode) {
        if (!morseCode) {
            return '等待解码...';
        }
        
        const words = morseCode.split(' / ');
        const translatedWords = words.map(word => {
            const letters = word.split(' ').filter(letter => letter.length > 0);
            return letters.map(letter => this.morseTable[letter] || '?').join('');
        });
        
        return translatedWords.join(' ');
    }
    
    clearResults() {
        this.lightStates = [];
        this.currentLetter = '';
        this.realtimeMorse = '';
        this.brightnessHistory = [];
    }
    
    setThresholdOffset(offset) {
        this.thresholdOffset = offset;
    }
    
    setAutoThreshold(enabled) {
        this.autoThresholdEnabled = enabled;
        if (!enabled) {
            this.brightnessHistory = [];
        }
    }
    
    cleanupLightStates() {
        // 只清理过期的lightStates，但保留莫斯电码解析结果
        const tenSecondsAgo = Date.now() - 10000;
        let cleanupIndex = 0;
        
        // 找到10秒前的数据位置
        for (let i = 0; i < this.lightStates.length - 1; i++) {
            if (this.lightStates[i].startTime > tenSecondsAgo) {
                cleanupIndex = i;
                break;
            }
        }
        
        // 如果需要清理数据
        if (cleanupIndex > 0) {
            this.lightStates = this.lightStates.slice(cleanupIndex);
        }
        
        // 如果数组仍然太大，保留最近的一半数据
        if (this.lightStates.length > this.maxLightStates) {
            const keepCount = Math.floor(this.maxLightStates / 2);
            this.lightStates = this.lightStates.slice(-keepCount);
            // 注意：这里不清除 realtimeMorse 和 currentLetter
        }
    }
}

const detector = new DetectionWorker();

self.addEventListener('message', function(e) {
    const { type, data, messageId } = e.data;
    
    switch (type) {
        case 'CALCULATE_BRIGHTNESS':
            const result = detector.calculateBrightness(
                data.imageData, 
                data.threshold,
                data.autoThreshold
            );
            self.postMessage({
                type: 'BRIGHTNESS_RESULT',
                data: result,
                messageId: messageId
            });
            break;
            
        case 'PROCESS_SIGNAL':
            const signalResult = detector.processSignal(
                data.isLightOn,
                data.currentTime,
                data.dotLength
            );
            if (signalResult) {
                self.postMessage({
                    type: 'SIGNAL_RESULT',
                    data: signalResult,
                    messageId: messageId
                });
            } else {
                // 即使没有结果也要回复，告知主线程处理完成
                self.postMessage({
                    type: 'SIGNAL_PROCESSED',
                    messageId: messageId
                });
            }
            break;
            
        case 'CLEAR_RESULTS':
            detector.clearResults();
            self.postMessage({
                type: 'RESULTS_CLEARED',
                messageId: messageId
            });
            break;
            
        case 'SET_THRESHOLD_OFFSET':
            detector.setThresholdOffset(data.offset);
            self.postMessage({
                type: 'THRESHOLD_OFFSET_SET',
                messageId: messageId
            });
            break;
            
        case 'SET_AUTO_THRESHOLD':
            detector.setAutoThreshold(data.enabled);
            self.postMessage({
                type: 'AUTO_THRESHOLD_SET',
                messageId: messageId
            });
            break;
            
        default:
            console.warn('Unknown worker message type:', type);
    }
});
