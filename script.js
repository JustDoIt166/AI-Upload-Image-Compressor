// ==UserScript==
// @name        AI 网页图片上传 压缩 
// @namespace    https://github.com/JustDoIt166
// @version      1.2
// @description  拦截网页图片上传，替换为压缩后的图片，体积更小、加载更快；支持拖动、双击隐藏设置按钮；支持自定义快捷键唤出按钮
// @author       JustDoIt166
// @match        https://chat.qwen.ai/*
// @match        https://chat.z.ai/*
// @match        https://gemini.google.com/*
// @match        https://chat.deepseek.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const SITE_CONFIGS = {
        'chat.qwen.ai': { fileInputSelector: 'input[type="file"]', name: 'Qwen' },
        'chat.z.ai': { fileInputSelector: 'input[type="file"]', name: 'Z.AI' },
        'gemini.google.com': { fileInputSelector: 'input[type="file"]', name: 'Gemini' },
        'chat.deepseek.com': { fileInputSelector: 'input[type="file"]', name: 'DeepSeek' }
    };

    const DEFAULT_SETTINGS = {
        mimeType: 'image/webp',
        quality: 0.7,
        maxWidth: 1920,
        maxHeight: 1080,
        autoCompress: true,
        adaptiveQuality: true,
        enableHotkey: true,
        hotkey: 'Alt+C'
    };

    const stats = {
        totalCompressed: 0,
        totalSizeSaved: 0,
        compressionHistory: []
    };

    const ImageCompressor = {
        settings: { ...DEFAULT_SETTINGS },
        worker: null,

        init() {
            this.loadSettings();
            this.loadStats();
            this.setupEventListeners();
            this.createUI();
            this.initWorker();
            this.setupHotkeyListener();
            console.log('🛡️ 图片压缩脚本 v1.0 已激活');
        },

        loadSettings() {
            const saved = localStorage.getItem('imageCompressSettings');
            if (saved) {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            }
        },

        saveSettings() {
            localStorage.setItem('imageCompressSettings', JSON.stringify(this.settings));
        },

        loadStats() {
            const saved = localStorage.getItem('compressStats');
            if (saved) {
                const savedStats = JSON.parse(saved);
                stats.totalCompressed = savedStats.totalCompressed || 0;
                stats.totalSizeSaved = savedStats.totalSizeSaved || 0;
                stats.compressionHistory = savedStats.compressionHistory || [];
            }
        },

        updateStats(originalSize, compressedSize) {
            stats.totalCompressed++;
            stats.totalSizeSaved += originalSize - compressedSize;
            stats.compressionHistory.push({
                date: new Date(),
                originalSize,
                compressedSize,
                saved: originalSize - compressedSize
            });
            localStorage.setItem('compressStats', JSON.stringify(stats));
        },

        initWorker() {
            const workerCode = `
                self.onmessage = async function(e) {
                    const { file, mimeType, quality, maxWidth, maxHeight } = e.data;
                    try {
                        const imageBitmap = await createImageBitmap(file);
                        let { width, height } = imageBitmap;

                        if (width > maxWidth) {
                            height = (height * maxWidth) / width;
                            width = maxWidth;
                        }
                        if (height > maxHeight) {
                            width = (width * maxHeight) / height;
                            height = maxHeight;
                        }

                        const canvas = new OffscreenCanvas(width, height);
                        const ctx = canvas.getContext('2d');

                        if (mimeType === 'image/jpeg') {
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillRect(0, 0, width, height);
                        }

                        ctx.drawImage(imageBitmap, 0, 0, width, height);
                        imageBitmap.close();

                        const blob = await canvas.convertToBlob({ type: mimeType, quality });
                        self.postMessage({ compressedBlob: blob });
                    } catch (error) {
                        self.postMessage({ error: error.message });
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob));
        },

        compress(file, onProgress) {
            return new Promise((resolve, reject) => {
                if (!this.worker) {
                    reject(new Error('Worker not initialized'));
                    return;
                }
                let quality = this.settings.quality;
                if (this.settings.adaptiveQuality) {
                    quality = this.getAdaptiveQuality(file.size);
                }
                this.worker.onmessage = (e) => {
                    if (e.data.error) {
                        reject(new Error(e.data.error));
                    } else {
                        resolve(e.data.compressedBlob);
                    }
                };
                this.worker.postMessage({
                    file,
                    mimeType: this.settings.mimeType,
                    quality,
                    maxWidth: this.settings.maxWidth,
                    maxHeight: this.settings.maxHeight
                });
            });
        },

        getAdaptiveQuality(fileSize) {
            if (fileSize < 1024 * 1024) return 0.9;
            if (fileSize < 5 * 1024 * 1024) return 0.7;
            return 0.5;
        },

        async handleMultipleFiles(files) {
            const compressedFiles = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (!file.type.startsWith('image/')) continue;
                this.showToast(`处理图片 ${i + 1}/${files.length}: ${file.name}`, 'info');
                try {
                    const compressedBlob = await this.compress(file);
                    const compressedFile = new File([compressedBlob], file.name, {
                        type: this.settings.mimeType,
                        lastModified: Date.now()
                    });
                    compressedFiles.push(compressedFile);
                    this.updateStats(file.size, compressedFile.size);
                    const savedMB = ((file.size - compressedFile.size) / 1024 / 1024).toFixed(2);
                    this.showToast(`✅ ${file.name} 压缩完成，节省 ${savedMB} MB`, 'success');
                } catch (err) {
                    console.error(`压缩 ${file.name} 失败:`, err);
                    this.showToast(`❌ 压缩 ${file.name} 失败`, 'error');
                }
            }
            return compressedFiles;
        },

        setupEventListeners() {
            document.addEventListener('change', async (e) => {
                if (e._myScriptIsProcessing) return;
                const target = e.target;
                if (!(target?.tagName === 'INPUT' && target.type === 'file' && target.files?.length > 0)) {
                    return;
                }
                const imageFiles = Array.from(target.files).filter(file => file.type.startsWith('image/'));
                if (imageFiles.length === 0) return;
                if (!this.settings.autoCompress) return;
                e.stopImmediatePropagation();
                e.preventDefault();
                try {
                    const compressedFiles = await this.handleMultipleFiles(imageFiles);
                    const dt = new DataTransfer();
                    Array.from(target.files).forEach(file => {
                        if (!file.type.startsWith('image/')) dt.items.add(file);
                    });
                    compressedFiles.forEach(file => dt.items.add(file));
                    target.files = dt.files;
                    const newEvent = new Event('change', { bubbles: true, cancelable: true });
                    newEvent._myScriptIsProcessing = true;
                    target.dispatchEvent(newEvent);
                } catch (err) {
                    console.error('❌ 压缩替换失败:', err);
                    this.showToast('❌ 图片压缩失败，请重试', 'error');
                }
            }, true);
        },

        createUI() {
            const settingsBtn = document.createElement('div');
            settingsBtn.id = 'compress-settings-btn';
            settingsBtn.innerHTML = '🖼️';
            settingsBtn.title = '图片压缩设置（双击隐藏）';
            settingsBtn.style.cssText = `
                position: fixed;
                top: 50%;
                right: 20px;
                transform: translateY(-50%);
                width: 50px;
                height: 50px;
                background: #2196f3;
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                cursor: move;
                z-index: 99999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                transition: transform 0.2s;
                user-select: none;
            `;
            let isDragging = false;
            let offsetX, offsetY;

            const onMouseDown = (e) => {
                isDragging = true;
                const rect = settingsBtn.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                settingsBtn.style.cursor = 'grabbing';
                e.preventDefault();
            };

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const x = e.clientX - offsetX;
                const y = e.clientY - offsetY;
                const maxX = window.innerWidth - settingsBtn.offsetWidth;
                const maxY = window.innerHeight - settingsBtn.offsetHeight;
                const boundedX = Math.max(0, Math.min(x, maxX));
                const boundedY = Math.max(0, Math.min(y, maxY));
                settingsBtn.style.left = `${boundedX}px`;
                settingsBtn.style.top = `${boundedY}px`;
                settingsBtn.style.right = 'auto';
                settingsBtn.style.bottom = 'auto';
                settingsBtn.style.transform = 'none';
            };

            const onMouseUp = () => {
                isDragging = false;
                settingsBtn.style.cursor = 'move';
            };

            settingsBtn.addEventListener('mousedown', onMouseDown);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            // 双击隐藏（桌面）
            settingsBtn.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                settingsBtn.style.display = 'none';
            });

            // 移动端双击模拟
            let lastTap = 0;
            settingsBtn.addEventListener('touchstart', (e) => {
                const now = Date.now();
                if (now - lastTap < 300 && now - lastTap > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    settingsBtn.style.display = 'none';
                    lastTap = 0;
                } else {
                    lastTap = now;
                }
            });

            settingsBtn.addEventListener('click', (e) => {
                if (isDragging) return;
                e.stopPropagation();
                this.toggleSettingsPanel();
            });

            settingsBtn.addEventListener('mouseenter', () => {
                if (!isDragging) settingsBtn.style.transform = 'scale(1.1)';
            });

            settingsBtn.addEventListener('mouseleave', () => {
                if (!isDragging) settingsBtn.style.transform = 'scale(1)';
            });

            document.body.appendChild(settingsBtn);
            this.createSettingsPanel();
        },

        createSettingsPanel() {
            if (document.getElementById('compress-settings-panel')) return;

            const panel = document.createElement('div');
            panel.id = 'compress-settings-panel';
            panel.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                z-index: 100000;
                width: 400px;
                max-width: 90vw;
                max-height: 80vh;
                overflow-y: auto;
                display: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                padding: 24px;
                box-sizing: border-box;
            `;

            const savedMB = (stats.totalSizeSaved / 1024 / 1024).toFixed(2);

            panel.innerHTML = `
                <h3 style="margin-top: 0; color: #333;">图片压缩设置</h3>
                <div class="setting-item" style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; color: #555;">
                        压缩质量: <span id="quality-value">${this.settings.quality}</span>
                    </label>
                    <input type="range" id="quality-slider" min="0.1" max="1" step="0.1" value="${this.settings.quality}" style="width: 100%;">
                </div>
                <div class="setting-item" style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; color: #555;">
                        输出格式:
                    </label>
                    <select id="output-format" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <option value="image/webp" ${this.settings.mimeType === 'image/webp' ? 'selected' : ''}>WebP（推荐，更小体积）</option>
                        <option value="image/jpeg" ${this.settings.mimeType === 'image/jpeg' ? 'selected' : ''}>JPEG（兼容性好）</option>
                    </select>
                </div>
                <div class="setting-item" style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; color: #555;">
                        最大宽度 (px):
                    </label>
                    <input type="number" id="max-width" value="${this.settings.maxWidth}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>
                <div class="setting-item" style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; color: #555;">
                        最大高度 (px):
                    </label>
                    <input type="number" id="max-height" value="${this.settings.maxHeight}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>
                <div class="setting-item" style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; color: #555;">
                        <input type="checkbox" id="auto-compress" ${this.settings.autoCompress ? 'checked' : ''} style="margin-right: 8px;">
                        自动压缩上传的图片
                    </label>
                </div>
                <div class="setting-item" style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; color: #555;">
                        <input type="checkbox" id="adaptive-quality" ${this.settings.adaptiveQuality ? 'checked' : ''} style="margin-right: 8px;">
                        自适应压缩质量
                    </label>
                </div>
                <div class="setting-item" style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; color: #555;">
                        <input type="checkbox" id="enable-hotkey" ${this.settings.enableHotkey ? 'checked' : ''} style="margin-right: 8px;">
                        启用快捷键唤出设置按钮
                    </label>
                </div>
                <div class="setting-item" style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; color: #555;">
                        快捷键（示例：Alt+C、Ctrl+Shift+P）:
                    </label>
                    <input type="text" id="hotkey-input" value="${this.settings.hotkey}"
                           placeholder="例如：Alt+C"
                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    <p style="font-size: 12px; color: #888; margin-top: 4px;">
                        支持 Ctrl / Shift / Alt / Meta（Mac ⌘）+ 字母/数字/F1~F12
                    </p>
                </div>
                <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #eee;">
                    <p style="color: #666; font-size: 14px; margin: 0 0 16px 0;">
                        已压缩 ${stats.totalCompressed} 张图片，节省 ${savedMB} MB 空间
                    </p>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="reset-stats" style="padding: 8px 16px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        重置统计
                    </button>
                    <button id="save-settings" style="padding: 8px 16px; background: #2196f3; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        保存设置
                    </button>
                </div>
                <a href="https://github.com/JustDoIt166/AI-Upload-Image-Compressor" target="_blank"
                 style="display: block; margin-top: 12px; color: #2196f3; text-decoration: none; font-size: 13px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" style="fill: currentColor;">
                  <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.81 3.65-3.93 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.04-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.27-.82 2.15 0 3.12 1.86 3.73 3.64 3.93-.24.21-.45.74-.45 1.48 0 1.07.01 1.93.01 2.2 0 .21-.15.46-.55.38A8.013 8.013 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                </svg>
                查看 脚本源代码
              </a>
            `;

            document.body.appendChild(panel);

            const qualitySlider = panel.querySelector('#quality-slider');
            const qualityValue = panel.querySelector('#quality-value');
            qualitySlider.addEventListener('input', (e) => {
                qualityValue.textContent = e.target.value;
            });

            panel.querySelector('#save-settings').addEventListener('click', () => {
                this.settings.quality = parseFloat(qualitySlider.value);
                this.settings.mimeType = panel.querySelector('#output-format').value;
                this.settings.maxWidth = parseInt(panel.querySelector('#max-width').value);
                this.settings.maxHeight = parseInt(panel.querySelector('#max-height').value);
                this.settings.autoCompress = panel.querySelector('#auto-compress').checked;
                this.settings.adaptiveQuality = panel.querySelector('#adaptive-quality').checked;
                this.settings.enableHotkey = panel.querySelector('#enable-hotkey').checked;
                this.settings.hotkey = panel.querySelector('#hotkey-input').value.trim() || 'Alt+C';

                this.saveSettings();
                this.setupHotkeyListener();
                this.showToast('设置已保存', 'success');
                panel.style.display = 'none';
            });

            panel.querySelector('#reset-stats').addEventListener('click', () => {
                stats.totalCompressed = 0;
                stats.totalSizeSaved = 0;
                stats.compressionHistory = [];
                localStorage.setItem('compressStats', JSON.stringify(stats));
                const statEl = panel.querySelector('p');
                if (statEl) {
                    statEl.textContent = `已压缩 0 张图片，节省 0.00 MB 空间`;
                }
                this.showToast('统计已重置', 'info');
            });

            panel.addEventListener('click', (e) => {
                if (e.target === panel) panel.style.display = 'none';
            });
        },

        toggleSettingsPanel() {
            let panel = document.getElementById('compress-settings-panel');
            if (!panel) {
                this.createSettingsPanel();
                panel = document.getElementById('compress-settings-panel');
            }

            if (panel.style.display === 'block') {
                panel.style.display = 'none';
            } else {
                panel.style.display = 'block';
                const savedMB = (stats.totalSizeSaved / 1024 / 1024).toFixed(2);
                const statEl = panel.querySelector('p');
                if (statEl) {
                    statEl.textContent = `已压缩 ${stats.totalCompressed} 张图片，节省 ${savedMB} MB 空间`;
                }
            }
        },

        parseHotkey(hotkeyStr) {
            const parts = hotkeyStr.toLowerCase().split('+').map(p => p.trim());
            const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
            let key = '';

            for (const part of parts) {
                if (part === 'ctrl') modifiers.ctrl = true;
                else if (part === 'shift') modifiers.shift = true;
                else if (part === 'alt') modifiers.alt = true;
                else if (['meta', 'cmd', 'command'].includes(part)) modifiers.meta = true;
                else key = part;
            }

            return { ...modifiers, key };
        },

        handleHotkeyEvent: function (e) {
            // 使用普通函数以确保可移除监听器，通过闭包绑定 this
            const self = ImageCompressor;
            if (!self.settings.enableHotkey || !self.settings.hotkey) return;

            const config = self.parseHotkey(self.settings.hotkey);
            const keyMatch = e.key.toLowerCase() === config.key;
            const ctrlMatch = e.ctrlKey === config.ctrl;
            const shiftMatch = e.shiftKey === config.shift;
            const altMatch = e.altKey === config.alt;
            const metaMatch = e.metaKey === config.meta;

            if (keyMatch && ctrlMatch && shiftMatch && altMatch && metaMatch) {
                e.preventDefault();
                const btn = document.getElementById('compress-settings-btn');
                if (btn && btn.style.display === 'none') {
                    btn.style.display = 'flex';
                    btn.style.transform = 'scale(1.15)';
                    setTimeout(() => {
                        if (btn.style.display !== 'none') {
                            btn.style.transform = 'scale(1)';
                        }
                    }, 200);
                }
            }
        },

        setupHotkeyListener() {
            document.removeEventListener('keydown', this.handleHotkeyEvent);
            if (this.settings.enableHotkey) {
                document.addEventListener('keydown', this.handleHotkeyEvent);
            }
        },

        showToast(message, type = 'info') {
            let container = document.getElementById('qwen-compress-toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'qwen-compress-toast-container';
                container.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 999999;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    pointer-events: none;
                `;
                document.body.appendChild(container);
            }

            const toast = document.createElement('div');
            const bgColor = type === 'error' ? '#ff4444' : type === 'success' ? '#4caf50' : '#2196f3';
            toast.textContent = message;
            toast.style.cssText = `
                background: ${bgColor};
                color: white;
                padding: 10px 16px;
                margin-bottom: 8px;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                max-width: 300px;
                word-break: break-word;
                font-size: 14px;
                opacity: 0;
                transform: translateX(100%);
                transition: opacity 0.3s ease, transform 0.3s ease;
            `;

            container.appendChild(toast);

            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(0)';
            });

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (toast.parentNode) toast.parentNode.removeChild(toast);
                    if (container && !container.hasChildNodes()) container.remove();
                }, 300);
            }, 3000);
        }
    };

    ImageCompressor.init();
})();
