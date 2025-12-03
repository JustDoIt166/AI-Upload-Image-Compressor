self.onmessage = async function(e) {
                    if (typeof OffscreenCanvas === 'undefined') {
                        self.postMessage({ error: '浏览器不支持后台压缩 (OffscreenCanvas missing)' });
                        return;
                    }
                    if (typeof createImageBitmap === 'undefined') {
                        self.postMessage({ error: '浏览器不支持 createImageBitmap' });
                        return;
                    }
                    const { file, mimeType, quality, maxWidth, maxHeight } = e.data;
                    try {
                        const imageBitmap = await createImageBitmap(file);
                        let width = imageBitmap.width;
                        let height = imageBitmap.height;
                        const originalRatio = width / height;

                        let needsResize = false;
                        if (width > maxWidth) {
                            width = maxWidth;
                            height = width / originalRatio;
                            needsResize = true;
                        }
                        if (height > maxHeight) {
                            height = maxHeight;
                            width = height * originalRatio;
                            needsResize = true;
                        }

                        const canvas = new OffscreenCanvas(
                            needsResize ? Math.round(width) : imageBitmap.width,
                            needsResize ? Math.round(height) : imageBitmap.height
                        );

                        const ctx = canvas.getContext('2d', { alpha: mimeType !== 'image/jpeg' });
                        if (!ctx) {
                            self.postMessage({ error: '无法获取绘图上下文' });
                            imageBitmap.close();
                            return;
                        }

                        if (mimeType === 'image/jpeg') {
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }

                        ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
                        imageBitmap.close();

                        const blob = await canvas.convertToBlob({ type: mimeType, quality });
                        self.postMessage({ compressedBlob: blob });
                    } catch (error) {
                        self.postMessage({ error: error && error.message ? error.message : String(error) });
                    }
                };
