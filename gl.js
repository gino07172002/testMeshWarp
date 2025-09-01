        const { createApp, onMounted, ref } = Vue;

       const app = createApp({
            setup() {
                const gl = ref(null);
                const program = ref(null);
                const colorProgram = ref(null);
                const texture = ref(null);
                const vertices = ref([]);
                const indices = ref([]);
                const linesIndices = ref([]);
                const vbo = ref(null);
                const ebo = ref(null);
                const eboLines = ref(null);
                const selectedVertex = ref(-1);

                const vertexShaderSource = `
                    attribute vec2 aPosition;
                    attribute vec2 aTexCoord;
                    varying vec2 vTexCoord;
                    void main() {
                        gl_Position = vec4(aPosition, 0.0, 1.0);
                        vTexCoord = vec2(aTexCoord.x, 1.0 - aTexCoord.y);
                    }
                `;

                const fragmentShaderSource = `
                    precision mediump float;
                    varying vec2 vTexCoord;
                    uniform sampler2D uTexture;
                    void main() {
                        gl_FragColor = texture2D(uTexture, vTexCoord);
                    }
                `;

                const colorVertexShaderSource = `
                    attribute vec2 aPosition;
                    uniform float uPointSize;
                    void main() {
                        gl_Position = vec4(aPosition, 0.0, 1.0);
                        gl_PointSize = uPointSize;
                    }
                `;

                const colorFragmentShaderSource = `
                    precision mediump float;
                    uniform vec4 uColor;
                    void main() {
                        gl_FragColor = uColor;
                    }
                `;

                function compileShader(gl, source, type) {
                    const shader = gl.createShader(type);
                    gl.shaderSource(shader, source);
                    gl.compileShader(shader);

                    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                        console.error('Shader compilation failed:', gl.getShaderInfoLog(shader));
                        return null;
                    }

                    return shader;
                }

                function createProgram(gl, vsSource, fsSource) {
                    const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
                    const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);

                    const program = gl.createProgram();
                    gl.attachShader(program, vertexShader);
                    gl.attachShader(program, fragmentShader);
                    gl.linkProgram(program);

                    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                        console.error('Program link failed:', gl.getProgramInfoLog(program));
                        return null;
                    }

                    return program;
                }

                function createBuffers(gl) {
                    const rows = 5, cols = 5;
                    const xStep = 2.0 / (cols - 1);
                    const yStep = 2.0 / (rows - 1);
                    const currentVertices = [];
                    const currentIndices = [];
                    const currentLinesIndices = [];

                    for (let y = 0; y < rows; y++) {
                        for (let x = 0; x < cols; x++) {
                            currentVertices.push(
                                -1.0 + x * xStep,
                                1.0 - y * yStep,
                                x / (cols - 1),
                                y / (rows - 1)
                            );
                        }
                    }

                    for (let y = 0; y < rows - 1; y++) {
                        for (let x = 0; x < cols - 1; x++) {
                            const row1 = y * cols;
                            const row2 = (y + 1) * cols;
                            currentIndices.push(
                                row1 + x, row2 + x, row1 + x + 1,
                                row1 + x + 1, row2 + x, row2 + x + 1
                            );
                        }
                    }

                    for (let y = 0; y < rows; y++) {
                        for (let x = 0; x < cols - 1; x++) {
                            currentLinesIndices.push(y * cols + x, y * cols + x + 1);
                        }
                    }
                    for (let x = 0; x < cols; x++) {
                        for (let y = 0; y < rows - 1; y++) {
                            currentLinesIndices.push(y * cols + x, (y + 1) * cols + x);
                        }
                    }

                    vertices.value = currentVertices;
                    indices.value = currentIndices;
                    linesIndices.value = currentLinesIndices;

                    const currentVbo = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, currentVbo);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);
                    vbo.value = currentVbo;

                    const currentEbo = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, currentEbo);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);
                    ebo.value = currentEbo;

                    const currentEboLines = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, currentEboLines);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);
                    eboLines.value = currentEboLines;
                }

                function loadTexture(gl, url) {
                    return new Promise((resolve, reject) => {
                        const image = new Image();
                        image.onload = () => {
                            const currentTexture = gl.createTexture();
                            gl.bindTexture(gl.TEXTURE_2D, currentTexture);

                            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

                            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

                            gl.bindTexture(gl.TEXTURE_2D, null);

                            texture.value = currentTexture;
                            resolve(currentTexture);
                        };

                        image.onerror = (error) => {
                            console.error("Image loading failed:", error);
                            reject(error);
                        };

                        image.src = url;
                    });
                }

                function setupEventHandlers(canvas, gl) {
                    canvas.addEventListener('mousedown', (e) => {
                        if (e.button === 0) {
                            console.log(" hi click ... ");
                            const rect = canvas.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;

                            const xNDC = (x / canvas.width) * 2 - 1;
                            const yNDC = 1 - (y / canvas.height) * 2;

                            let minDist = Infinity;
                            let closestIndex = -1;

                            for (let i = 0; i < vertices.value.length; i += 4) {
                                const dx = vertices.value[i] - xNDC;
                                const dy = vertices.value[i + 1] - yNDC;
                                const dist = dx * dx + dy * dy;

                                if (dist < minDist) {
                                    minDist = dist;
                                    closestIndex = i / 4;
                                }
                            }

                            if (minDist < 0.02) {
                                selectedVertex.value = closestIndex;
                            }
                        }
                    });

                    canvas.addEventListener('mouseup', () => selectedVertex.value = -1);

                    canvas.addEventListener('mousemove', (e) => {
                        if (selectedVertex.value !== -1) {
                            const rect = canvas.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;

                            const xNDC = (x / canvas.width) * 2 - 1;
                            const yNDC = 1 - (y / canvas.height) * 2;

                            const index = selectedVertex.value * 4;
                            vertices.value[index] = xNDC;
                            vertices.value[index + 1] = yNDC;

                            gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
                            gl.bufferSubData(gl.ARRAY_BUFFER, index * 4,
                                new Float32Array([xNDC, yNDC]));
                        }
                    });
                }

                function render(gl, program, colorProgram) {
                    gl.clearColor(0.0, 0.0, 0.0, 1.0);
                    gl.clear(gl.COLOR_BUFFER_BIT);

                    if (texture.value) {
                        gl.useProgram(program);
                        gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo.value);

                        gl.activeTexture(gl.TEXTURE0);
                        gl.bindTexture(gl.TEXTURE_2D, texture.value);

                        const textureUniform = gl.getUniformLocation(program, 'uTexture');
                        gl.uniform1i(textureUniform, 0);

                        const posAttrib = gl.getAttribLocation(program, 'aPosition');
                        const texAttrib = gl.getAttribLocation(program, 'aTexCoord');

                        gl.enableVertexAttribArray(posAttrib);
                        gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 16, 0);

                        gl.enableVertexAttribArray(texAttrib);
                        gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 16, 8);

                        gl.drawElements(gl.TRIANGLES, indices.value.length, gl.UNSIGNED_SHORT, 0);
                    }

                    gl.useProgram(colorProgram);
                    gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);

                    const colorPosAttrib = gl.getAttribLocation(colorProgram, 'aPosition');
                    gl.enableVertexAttribArray(colorPosAttrib);
                    gl.vertexAttribPointer(colorPosAttrib, 2, gl.FLOAT, false, 16, 0);

                    gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 1, 1, 1);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines.value);
                    gl.drawElements(gl.LINES, linesIndices.value.length, gl.UNSIGNED_SHORT, 0);

                    gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 0, 0, 1);
                    gl.uniform1f(gl.getUniformLocation(colorProgram, 'uPointSize'), 5.0);
                    gl.drawArrays(gl.POINTS, 0, vertices.value.length / 4);

                    requestAnimationFrame(() => render(gl, program, colorProgram));
                }

                function downloadImage(gl) {
                    console.log(" hi download ... ");
                    const canvas = document.getElementById('webgl');
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;
                    const tempCtx = tempCanvas.getContext('2d');

                    function cleanRender() {
                        gl.clearColor(0.0, 0.0, 0.0, 0.0);
                        gl.clear(gl.COLOR_BUFFER_BIT);

                        if (texture.value) {
                            gl.useProgram(program.value);
                            gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
                            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo.value);

                            gl.activeTexture(gl.TEXTURE0);
                            gl.bindTexture(gl.TEXTURE_2D, texture.value);
                            gl.uniform1i(gl.getUniformLocation(program.value, 'uTexture'), 0);

                            const posAttrib = gl.getAttribLocation(program.value, 'aPosition');
                            gl.enableVertexAttribArray(posAttrib);
                            gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 16, 0);

                            const texAttrib = gl.getAttribLocation(program.value, 'aTexCoord');
                            gl.enableVertexAttribArray(texAttrib);
                            gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 16, 8);

                            gl.drawElements(gl.TRIANGLES, indices.value.length, gl.UNSIGNED_SHORT, 0);
                        }

                        const width = canvas.width;
                        const height = canvas.height;
                        const pixels = new Uint8Array(width * height * 4);
                        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                        const imageData = tempCtx.createImageData(width, height);
                        imageData.data.set(pixels);

                        for (let row = 0; row < height / 2; row++) {
                            for (let col = 0; col < width * 4; col++) {
                                const temp = imageData.data[row * width * 4 + col];
                                imageData.data[row * width * 4 + col] =
                                    imageData.data[(height - row - 1) * width * 4 + col];
                                imageData.data[(height - row - 1) * width * 4 + col] = temp;
                            }
                        }

                        tempCtx.putImageData(imageData, 0, 0);
                        const dataURL = tempCanvas.toDataURL('image/png');

                        const downloadLink = document.createElement('a');
                        downloadLink.href = dataURL;
                        downloadLink.download = 'mesh_deformed_image.png';
                        document.body.appendChild(downloadLink);
                        downloadLink.click();
                        document.body.removeChild(downloadLink);
                    }

                    gl.flush();
                    requestAnimationFrame(cleanRender);
                }

                onMounted(async () => {
                    const canvas = document.getElementById('webgl');
                    const webglContext = canvas.getContext('webgl');
                    gl.value = webglContext; // Assign WebGL context to gl.value

                    program.value = createProgram(webglContext, vertexShaderSource, fragmentShaderSource);
                    colorProgram.value = createProgram(webglContext, colorVertexShaderSource, colorFragmentShaderSource);

                    try {
                        await loadTexture(webglContext, './input.jpg');
                        createBuffers(webglContext);
                        setupEventHandlers(canvas, webglContext);
                        render(webglContext, program.value, colorProgram.value);
                    } catch (error) {
                        console.error("Initialization error:", error);
                    }
                });

                return {
                    downloadImage: () => downloadImage(gl.value)
                };
            }
        });

export default app;
