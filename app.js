const { createApp, onMounted, ref } = Vue;

const app = Vue.createApp({
      data() {
        return {
          imageData: '',
          lastTimestamp: 0,
          status: '準備中',
          activeTool: null,
          points: [],
          fileDropdown: false,
          editDropdown: false,
          selectedLayerId: null,
          layers: [],
          layerCounter: 0,
          keyframes: [],
          keyframeCounter: 0,
          isDragging: false,
          startX: 0,
          scrollLeft: 0,
          dragStartX: 0,
          dragStartY: 0,
          points: [],
          fileDropdown: false,
          editDropdown: false,
          selectedLayerId: null,
          layers: [],
          layerCounter: 0,
          keyframes: [],
          keyframeCounter: 0,
          isDragging: false,
          startX: 0,
          scrollLeft: 0,
          hierarchicalData: {
            children: [
              {
                children: [
                  {
                    name: "GrandChild"
                  }
                ],
                name: "Child1"
              },
              {
                name: "Child2"
              }
            ],
            name: "Root"
          },
          expandedNodes: []
        };
      },
      mounted() {
        document.addEventListener('click', this.handleClickOutside);
        this.startImageUpdates();
        // 初始化時新增一個預設圖層
        this.addLayer();
      },

      beforeUnmount() {
        clearInterval(this.updateTimer);
      },
      unmounted() {
        document.removeEventListener('click', this.handleClickOutside);
      },
      methods: {

        fetchImage() {
          fetch('/png')
            .then(response => response.json())
            .then(data => {
              // 只有當時間戳記比上次更新時才更新圖片
              if (data.timestamp > this.lastTimestamp) {
                this.imageData = data.image;
                this.lastTimestamp = data.timestamp;
              }
            })
            .catch(error => console.error('圖片載入失敗:', error));
        },
        // 定期更新或在需要時呼叫
        startImageUpdates() {
          this.fetchImage();
          this.updateTimer = setInterval(() => {
            this.fetchImage();
          }, 200); // 每秒更新一次，可調整
        },
        handleCanvasClick(event) {
          // 處理點擊事件...
          // 編輯後可能需要刷新圖片
          this.fetchImage();
        },
        // 關閉其他下拉選單
        closeAllDropdowns() {
          this.fileDropdown = false;
          this.editDropdown = false;
        },

        // 下拉選單切換
        toggleDropdown(dropdown) {
          console.log("hi dropdown ... ");
          this.closeAllDropdowns();
          if (dropdown === 'fileDropdown') {
            console.log("hi?... ");
            this.fileDropdown = !this.fileDropdown;
          } else if (dropdown === 'editDropdown') {
            console.log("hi! ... ");
            this.editDropdown = !this.editDropdown;
          }
        },

        // 處理檔案選單動作
        handleFileAction(action) {
          this.status = `執行檔案動作: ${action}`;
          this.closeAllDropdowns();

          if (action === 'save') {
            this.saveProjectToServer();
          }
        },

        // 處理編輯選單動作
        handleEditAction(action) {
          this.status = `執行編輯動作: ${action}`;
          this.closeAllDropdowns();
        },
        updateImage(newUrl) {
          this.imageUrl = newUrl;
          this.cacheBuster = Date.now(); // 更新 cacheBuster 來強制刷新
        },
        // 選擇工具
        selectTool(tool) {
          console.log(" hi  ", tool);
          this.activeTool = this.activeTool === tool ? null : tool;
          this.status = `選擇工具: ${tool}`;

          const projectData = {
            tool: tool
          };

          fetch('/api/tool1', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(projectData)
          })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                this.status = '專案儲存成功!';
              } else {
                this.status = '專案儲存失敗: ' + data.message;
              }
            })
            .catch(error => {
              this.status = '專案儲存失敗: ' + error.message;
              console.error('儲存專案時發生錯誤:', error);
            });
        },
        getMousePosition(event) {
          const rect = this.$refs.imageContainer.getBoundingClientRect();
          // Calculate the scroll position of the container
          const scrollLeft = this.$refs.imageContainer.scrollLeft;
          const scrollTop = this.$refs.imageContainer.scrollTop;
          // Calculate the click position relative to the image container
          // by accounting for the container's position, borders, and scroll position
          const x = event.clientX - rect.left + scrollLeft;
          const y = event.clientY - rect.top + scrollTop;
          return { x, y };
        },
        // 畫布點擊處理
        handleCanvasMouseDown(event) {
          // Get the bounding rectangle of the image container
          const { x, y } = this.getMousePosition(event);

          event.preventDefault();


          if (event.button === 0) { // 左鍵點擊
            // 記錄拖曳起始位置
            this.isDragging = true;
            this.dragStartX = x;
            this.dragStartY = y;
            this.status = `開始拖曳: x=${x}, y=${y}`;
            console.log(" drag start x: ", this.dragStartX, ", y: ", this.dragStartY);

            fetch('/api/clickStart', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                x,
                y,
                scw: this.$refs.imageContainer.scrollWidth,
                sch: this.$refs.imageContainer.scrollHeight
              })
            });

          } else if (event.button === 2) { // 右鍵點擊
            this.status = `右鍵點擊: x=${x}, y=${y}`;
            // 處理右鍵點擊的功能，例如顯示上下文選單
            // 這裡添加您的右鍵點擊處理代碼

            // 示例：移除最近點
            if (this.points.length > 0) {
              this.points.pop();
              this.status = `右鍵移除最後一個點，剩餘 ${this.points.length} 個點`;
            }
          }
          this.updateImage('/png');
        },



        handleCanvasMouseMove(e) {

          if (!this.isDragging) return;

          const { x, y } = this.getMousePosition(e);

          // 拖曳過程中更新狀態

          if (e.ctrlKey) {
            this.status = `拖曳中with ctrl : x=${x}, y=${y}`;
          }
          else {
            this.status = `拖曳中: x=${x}, y=${y}`;
          }
          this.sendDragToServer(x, y, e);
          // 您可以在這裡添加拖曳期間的視覺反饋
          // 例如畫一條線從起始點到當前位置
        },

        handleCanvasMouseUp(e) {
          const { x, y } = this.getMousePosition(e);
          if (e.button === 0) {
            console.log("mouse release");
            // 左鍵釋放
            if (this.isDragging) {
              this.isDragging = false;

              // 計算拖曳距離
              const dx = x - this.dragStartX;
              const dy = y - this.dragStartY;
              const distance = Math.sqrt(dx * dx + dy * dy);

              console.log("left relese ... x : ", x, " y : ", y, " distance : ", distance);
              if (distance < 5) {
                // 視為點擊而非拖曳
                this.handleLeftClick(x, y, e);
              } else {
                // 處理拖曳完成
                this.handleDragEnd(x, y, e);
              }
            }
          }
        },

        handleLeftClick(x, y) {
          console.log("left click ... ", x, " , ", y);
          this.status = `左鍵點擊: x=${x}, y=${y}`;
          this.points.push({ x, y });

          // 原有的功能：發送座標到伺服器
          this.sendPointToServer(x, y);
        },

        getBasePayload(x, y, event) {
          const payload = {
            x,
            y,
            scw: this.$refs.imageContainer.scrollWidth,
            sch: this.$refs.imageContainer.scrollHeight
          };

          // 統一處理按鍵狀態
          ['ctrlKey', 'shiftKey', 'altKey'].forEach(key => {
            if (event && event[key]) {
              payload[key] = true;
            }
          });

          return payload;
        },

        // 優化後的 handleDragEnd
        handleDragEnd(x, y, event) {
          const payload = this.getBasePayload(x, y, event);

          this.status = `拖曳結束: 從 (${this.dragStartX}, ${this.dragStartY}) 到 (${x}, ${y})`;

          fetch('/api/dragDone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        },

        // 優化後的 sendPointToServer
        sendPointToServer(x, y, event) {
          const payload = this.getBasePayload(x, y, event);

          fetch('/api/points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
            .then(response => response.json())
            .then(data => {
              console.log('伺服器回應:', data);
              this.points.push({ x: data.x, y: data.y });
              this.status = `最近的網格點: x=${data.x}, y=${data.y}`;
            })
            .catch(error => {
              this.status = 'point bad: ' + error.message;
            });
        },

        // 優化後的 sendDragToServer
        sendDragToServer(x, y, event) {
          const payload = this.getBasePayload(x, y, event);

          fetch('/api/drag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        },


        // 清除所有點
        clearPoints() {
          this.points = [];
          this.status = '已清除所有點';
        },

        // 新增圖層
        addLayer() {
          this.layerCounter++;
          const newLayer = {
            id: this.layerCounter,
            name: `圖層 ${this.layerCounter}`
          };
          this.layers.push(newLayer);
          this.status = `新增圖層: ${newLayer.name}`;
        },

        // 選擇圖層
        selectLayer(id) {
          this.selectedLayerId = id;
          const layer = this.layers.find(l => l.id === id);
          if (layer) {
            this.status = `選擇圖層: ${layer.name} , id = ${id}`;
          }
        },

        // 刪除選中圖層
        deleteLayer() {
          if (this.selectedLayerId) {
            const layerIndex = this.layers.findIndex(l => l.id === this.selectedLayerId);
            if (layerIndex !== -1) {
              const layerName = this.layers[layerIndex].name;
              this.layers.splice(layerIndex, 1);
              this.status = `刪除圖層: ${layerName}`;
              this.selectedLayerId = this.layers.length > 0 ? this.layers[0].id : null;
            }
          } else {
            this.status = '沒有選擇圖層';
          }
        },

        // 新增關鍵幀
        addKeyframe() {
          this.keyframeCounter++;
          this.keyframes.push({
            id: this.keyframeCounter,
            position: 50 * this.keyframeCounter
          });
          this.status = `新增關鍵幀: ${this.keyframeCounter}`;
        },

        // 選擇關鍵幀
        selectKeyframe(id) {
          this.status = `選擇關鍵幀: ${id}`;
        },

        // 新增時間軸元件
        addTimelineComponent() {
          this.status = '新增時間軸元件';
          alert('新增時間軸元件功能觸發');
        },

        // 時間軸拖曳功能
        startDrag(e) {
          this.isDragging = true;
          this.startX = e.pageX - this.$refs.timelineTracks.offsetLeft;
          this.scrollLeft = this.$refs.timelineTracks.scrollLeft;
        },

        onDrag(e) {
          if (!this.isDragging) return;
          e.preventDefault();
          const x = e.pageX - this.$refs.timelineTracks.offsetLeft;
          const walk = (x - this.startX);
          this.$refs.timelineTracks.scrollLeft = this.scrollLeft - walk;
        },

        stopDrag() {
          this.isDragging = false;
        },

        // 將專案儲存到伺服器的API示例
        saveProjectToServer() {
          this.status = '正在儲存專案...';

          const projectData = {
            layers: this.layers,
            keyframes: this.keyframes,
            points: this.points
          };

          fetch('/api/project/save', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(projectData)
          })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                this.status = '專案儲存成功!';
              } else {
                this.status = '專案儲存失敗: ' + data.message;
              }
            })
            .catch(error => {
              this.status = '專案儲存失敗: ' + error.message;
              console.error('儲存專案時發生錯誤:', error);
            });
        },

        // 將圖層儲存到伺服器的API示例
        saveLayerToServer() {
          if (!this.selectedLayerId) {
            this.status = '請先選擇一個圖層';
            return;
          }

          this.status = '正在儲存圖層...';

          const selectedLayer = this.layers.find(l => l.id === this.selectedLayerId);
          const layerData = {
            layerId: this.selectedLayerId,
            layerName: selectedLayer.name,
            points: this.points.filter(p => p.layerId === this.selectedLayerId || !p.layerId)
          };

          fetch('/api/layer/save', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(layerData)
          })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                this.status = `圖層 ${selectedLayer.name} 儲存成功!`;
              } else {
                this.status = '圖層儲存失敗: ' + data.message;
              }
            })
            .catch(error => {
              this.status = '圖層儲存失敗: ' + error.message;
              console.error('儲存圖層時發生錯誤:', error);
            });
        },

        // 點擊頁面其他區域關閉下拉選單
        handleClickOutside(e) {
          const targetElement = e.target;
          if (!targetElement.closest('.menu-item')) {
            this.closeAllDropdowns();
          }
        },
        toggleNode(nodeId) {
          if (this.expandedNodes.includes(nodeId)) {
            this.expandedNodes = this.expandedNodes.filter(id => id !== nodeId);
          } else {
            this.expandedNodes.push(nodeId);
          }
        },
        handleNameClick(name) {
          console.log('Clicked node name:', name);
        },

        // 遞迴渲染階層式結構的方法（可選的實作方式）
        renderHierarchicalData(node, parentId = '') {
          const nodeId = parentId ? `${parentId}-${node.name}` : node.name;
          const hasChildren = node.children && node.children.length > 0;

          return {
            id: nodeId,
            name: node.name,
            hasChildren: hasChildren,
            children: hasChildren ? node.children.map(child => this.renderHierarchicalData(child, nodeId)) : []
          };
        }
      },
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

    // 掛載應用
export default app;
