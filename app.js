//app.js

const { createApp, onMounted, ref } = Vue;

import {
  initBone,
  skeletonVertices,
  originalSkeletonVertices,
  boneParents,
  boneChildren,
  vertexInfluences,
  isEditingExistingBone,
  selectedBoneForEditing,
  editingBoneEnd,
  clearBones,
  saveBones,
  readBones
} from './useBone.js';

import {
  gl,
  texture,
  program,
  colorProgram,
  skeletonProgram,
  vbo,
  ebo,
  eboLines,
  vertices,
  originalVertices,
  indices,
  linesIndices,
  initWebGL,
  createBuffers,
  render
} from './useWebGL.js';


// Shader sources
const shaders = {
  vertex: `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;
        varying vec2 vTexCoord;
        void main() {
          gl_Position = vec4(aPosition, 0.0, 1.0);
          vTexCoord = vec2(aTexCoord.x, 1.0 - aTexCoord.y);
        }
      `,
  fragment: `
        precision mediump float;
        varying vec2 vTexCoord;
        uniform sampler2D uTexture;
        void main() {
          gl_FragColor = texture2D(uTexture, vTexCoord);
        }
      `,
  colorVertex: `
        attribute vec2 aPosition;
        uniform float uPointSize;
        void main() {
          gl_Position = vec4(aPosition, 0.0, 1.0);
          gl_PointSize = uPointSize;
        }
      `,
  colorFragment: `
        precision mediump float;
        uniform vec4 uColor;
        void main() {
          gl_FragColor = uColor;
        }
      `,
  skeletonVertex: `
        attribute vec2 aPosition;
        uniform float uPointSize;
        void main() {
          gl_Position = vec4(aPosition, 0.0, 1.0);
          gl_PointSize = uPointSize;
        }
      `,
  skeletonFragment: `
        precision mediump float;
        uniform vec4 uColor;
        void main() {
          gl_FragColor = uColor;
        }
      `
};
const compileShader = (gl, source, type) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compilation failed:', gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
};

const createProgram = (gl, vsSource, fsSource) => {
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
};

// Coordinate conversion utility function
const convertToNDC = (e, canvas, container) => {
  const rect = container.getBoundingClientRect();
  const scrollLeft = container.scrollLeft;
  const scrollTop = container.scrollTop;

  // Get coordinates relative to container
  const x = e.clientX - rect.left + scrollLeft;
  const y = e.clientY - rect.top + scrollTop;

  // Calculate scale factors
  const scaleX = canvas.width / container.clientWidth;
  const scaleY = canvas.height / container.clientHeight;

  // Convert to canvas coordinates
  const canvasX = x * scaleX;
  const canvasY = y * scaleY;

  // Convert to WebGL NDC
  return {
    x: (canvasX / canvas.width) * 2 - 1,
    y: 1 - (canvasY / canvas.height) * 2
  };
};

// ======= Texture Loading Functions =======
const loadTexture = (gl, url, imageData, imageWidth, imageHeight) => {
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

      // Store the image data for transparency checks
      // Create a temporary canvas to extract pixel data
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = image.width;
      tempCanvas.height = image.height;
      const tempCtx = tempCanvas.getContext('2d');

      // Draw the image
      tempCtx.drawImage(image, 0, 0);

      // Get pixel data
      const imgData = tempCtx.getImageData(0, 0, image.width, image.height);

      // Store for later use
      imageData.value = imgData.data;
      imageWidth.value = image.width;
      imageHeight.value = image.height;

      gl.bindTexture(gl.TEXTURE_2D, null);

      resolve(currentTexture);
    };

    image.onerror = (error) => {
      console.error("Image loading failed:", error);
      reject(error);
    };

    image.src = url;
  });
};

// ======= Feature-specific Functions =======
// Helper to check if an area is fully transparent
const isAreaTransparent = (x, y, w, h, imageData, imageWidth, imageHeight) => {
  if (!imageData.value) return false;

  const width = imageWidth.value;
  const height = imageHeight.value;

  // Convert normalized texture coordinates to pixel coordinates
  const startX = Math.floor(x * width);
  const startY = Math.floor(y * height);
  const endX = Math.min(Math.ceil((x + w) * width), width);
  const endY = Math.min(Math.ceil((y + h) * height), height);

  // Check each pixel in the area
  for (let py = startY; py < endY; py++) {
    for (let px = startX; px < endX; px++) {
      // Get the alpha value (every 4th byte in RGBA data)
      const pixelIndex = (py * width + px) * 4 + 3;
      // If any pixel has non-zero alpha, the area is not fully transparent
      if (imageData.value[pixelIndex] > 0) {
        return false;
      }
    }
  }

  // If we get here, all pixels had zero alpha
  return true;
};


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
      /*
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
        */
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
     // this.imageUrl = newUrl;
      this.cacheBuster = Date.now(); // 更新 cacheBuster 來強制刷新
    },
    // 選擇工具
    /*
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
    */
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
   // const gl = ref(null);
    const selectedVertex = ref(-1);
    const activeTool = ref('grab-point');
    const imageData = ref(null);
    const imageWidth = ref(0);
    const imageHeight = ref(0);
    const indices = ref([]);
    const linesIndices = ref([]);
    const skeletonIndices = ref([]);
    const selectedBone = ref(-1);
    const boneEndBeingDragged = ref(null);
    const isShiftPressed = ref(false);
    var parentBoneIndex = -1;
    var lineIndex = 0;
    const minBoneLength = 0.1;
    const transparentCells = ref(new Set()); // Store transparent cells
    const gridCells = ref([]);

  
    const resetMeshToOriginal = () => {
      if (originalVertices.value.length > 0) {
        for (let i = 0; i < vertices.value.length; i++) {
          vertices.value[i] = originalVertices.value[i];
        }
        if (originalSkeletonVertices.value.length > 0) {
          for (let i = 0; i < skeletonVertices.value.length; i++) {
            skeletonVertices.value[i] = originalSkeletonVertices.value[i];
          }
        }
        gl.value.bindBuffer(gl.value.ARRAY_BUFFER, vbo.value);
        gl.value.bufferData(gl.value.ARRAY_BUFFER, new Float32Array(vertices.value), gl.value.DYNAMIC_DRAW);
      }
    };


    const updateMeshForSkeletonPose = () => {
      const numVertices = vertices.value.length / 4;
      for (let i = 0; i < numVertices; i++) {
        const influences = vertexInfluences.value[i];
        if (influences.length === 0) {
          vertices.value[i * 4] = originalVertices.value[i * 4];
          vertices.value[i * 4 + 1] = originalVertices.value[i * 4 + 1];
          continue;
        }

        let skinnedX = 0;
        let skinnedY = 0;
        const originalX = originalVertices.value[i * 4];
        const originalY = originalVertices.value[i * 4 + 1];

        influences.forEach(({ boneIndex, weight }) => {
          const origBoneHeadX = originalSkeletonVertices.value[boneIndex * 4];
          const origBoneHeadY = originalSkeletonVertices.value[boneIndex * 4 + 1];
          const origBoneTailX = originalSkeletonVertices.value[boneIndex * 4 + 2];
          const origBoneTailY = originalSkeletonVertices.value[boneIndex * 4 + 3];

          const currBoneHeadX = skeletonVertices.value[boneIndex * 4];
          const currBoneHeadY = skeletonVertices.value[boneIndex * 4 + 1];
          const currBoneTailX = skeletonVertices.value[boneIndex * 4 + 2];
          const currBoneTailY = skeletonVertices.value[boneIndex * 4 + 3];

          const origBoneDirX = origBoneTailX - origBoneHeadX;
          const origBoneDirY = origBoneTailY - origBoneHeadY;
          const origBoneLength = Math.sqrt(origBoneDirX * origBoneDirX + origBoneDirY * origBoneDirY);

          const currBoneDirX = currBoneTailX - currBoneHeadX;
          const currBoneDirY = currBoneTailY - currBoneHeadY;
          const currBoneLength = Math.sqrt(currBoneDirX * currBoneDirX + currBoneDirY * currBoneDirY);

          const scale = currBoneLength / origBoneLength;

          const localX = originalX - origBoneHeadX;
          const localY = originalY - origBoneHeadY;

          const origAngle = Math.atan2(origBoneDirY, origBoneDirX);
          const currAngle = Math.atan2(currBoneDirY, currBoneDirX);
          const rotationAngle = currAngle - origAngle;

          const cosOrig = Math.cos(-origAngle);
          const sinOrig = Math.sin(-origAngle);
          const localRotX = localX * cosOrig - localY * sinOrig;
          const localRotY = localX * sinOrig + localY * cosOrig;

          const scaledX = localRotX * scale;
          const scaledY = localRotY;

          const cosCurr = Math.cos(currAngle);
          const sinCurr = Math.sin(currAngle);
          const transformedX = scaledX * cosCurr - scaledY * sinCurr;
          const transformedY = scaledX * sinCurr + scaledY * cosCurr;

          const worldX = transformedX + currBoneHeadX;
          const worldY = transformedY + currBoneHeadY;

          skinnedX += worldX * weight;
          skinnedY += worldY * weight;
        });

        vertices.value[i * 4] = skinnedX;
        vertices.value[i * 4 + 1] = skinnedY;
      }

      gl.value.bindBuffer(gl.value.ARRAY_BUFFER, vbo.value);
      gl.value.bufferData(gl.value.ARRAY_BUFFER, new Float32Array(vertices.value), gl.value.DYNAMIC_DRAW);
    };

  // 初始化一次 WebGL 依賴
  initBone(gl, program, texture, vbo, ebo, indices, resetMeshToOriginal, updateMeshForSkeletonPose);

   
    

    const lineIntersectsQuad = (x1, y1, x2, y2, quadVertices, vertexArray) => {
      const edges = [
        [0, 1], // topLeft -> topRight
        [1, 2], // topRight -> bottomRight
        [2, 3], // bottomRight -> bottomLeft
        [3, 0]  // bottomLeft -> topLeft
      ];

      for (const [i, j] of edges) {
        const v1x = vertexArray[quadVertices[i] * 4];
        const v1y = vertexArray[quadVertices[i] * 4 + 1];
        const v2x = vertexArray[quadVertices[j] * 4];
        const v2y = vertexArray[quadVertices[j] * 4 + 1];

        if (lineSegmentsIntersect(x1, y1, x2, y2, v1x, v1y, v2x, v2y)) {
          return true;
        }
      }
      return false;
    };

    // 檢查兩條線段是否相交
    const lineSegmentsIntersect = (x1, y1, x2, y2, x3, y3, x4, y4) => {
      const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (denom === 0) return false; // 平行線段

      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
      const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

      return t > 0 && t < 1 && u > 0 && u < 1;
    };

    // 檢查點是否在四邊形內
    const pointInQuad = (x, y, quadVertices, vertexArray) => {
      let inside = false;
      for (let i = 0, j = 3; i < 4; j = i++) {
        const xi = vertexArray[quadVertices[i] * 4];
        const yi = vertexArray[quadVertices[i] * 4 + 1];
        const xj = vertexArray[quadVertices[j] * 4];
        const yj = vertexArray[quadVertices[j] * 4 + 1];

        const intersect = ((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };
    // Function to check if a line passes through transparent cells
    const isLineThroughTransparent = (x1, y1, x2, y2, cols, rows) => {
      // 找到起點和終點所在的格子
      let startCell = -1;
      let endCell = -1;

      gridCells.value.forEach((cell, index) => {
        if (pointInQuad(x1, y1, cell.vertices, originalVertices.value)) {
          startCell = index;
        }
        if (pointInQuad(x2, y2, cell.vertices, originalVertices.value)) {
          endCell = index;
        }
      });

      // 檢查線段是否與任何透明格子相交，排除起點和終點格子
      return gridCells.value.some((cell, index) => {
        if (cell.isTransparent && index !== startCell && index !== endCell) {
          return lineIntersectsQuad(x1, y1, x2, y2, cell.vertices, originalVertices.value);
        }
        return false;
      });
    };


    // Modified computeVertexInfluences with transparency check
    const computeVertexInfluences = () => {
      const numVertices = vertices.value.length / 4;
      const numBones = originalSkeletonVertices.value.length / 4;
      const sigma = 0.1;
      const rows = 10; // Match with createBuffers
      const cols = 10;

      vertexInfluences.value = [];

      for (let i = 0; i < numVertices; i++) {
        const influences = [];
        const vertexX = originalVertices.value[i * 4];
        const vertexY = originalVertices.value[i * 4 + 1];

        for (let boneIndex = 0; boneIndex < numBones; boneIndex++) {
          const boneStartX = originalSkeletonVertices.value[boneIndex * 4];
          const boneStartY = originalSkeletonVertices.value[boneIndex * 4 + 1];
          const boneEndX = originalSkeletonVertices.value[boneIndex * 4 + 2];
          const boneEndY = originalSkeletonVertices.value[boneIndex * 4 + 3];

          // Check if lines to head and tail pass through transparent areas
          const headThroughTransparent = isLineThroughTransparent(vertexX, vertexY, boneStartX, boneStartY, cols, rows);
          const tailThroughTransparent = isLineThroughTransparent(vertexX, vertexY, boneEndX, boneEndY, cols, rows);

          if (headThroughTransparent && tailThroughTransparent) {
            // Skip this bone if both lines pass through transparent areas
            continue;
          }

          const distanceToBone = distanceFromPointToSegment(
            vertexX, vertexY,
            boneStartX, boneStartY,
            boneEndX, boneEndY
          );

          const weight = Math.exp(-(distanceToBone * distanceToBone) / (sigma * sigma));
          influences.push({ boneIndex, weight });
        }

        const totalWeight = influences.reduce((sum, inf) => sum + inf.weight, 0);
        if (totalWeight > 0) {
          influences.forEach(inf => (inf.weight /= totalWeight));
        }

        vertexInfluences.value[i] = influences;
      }
    };

    const applyTransformToChildren = (parentIndex, deltaX, deltaY, rotationAngle, pivotX, pivotY) => {
      if (boneChildren.value[parentIndex]) {
        boneChildren.value[parentIndex].forEach(childIndex => {
          const childHeadX = skeletonVertices.value[childIndex * 4];
          const childHeadY = skeletonVertices.value[childIndex * 4 + 1];
          const childTailX = skeletonVertices.value[childIndex * 4 + 2];
          const childTailY = skeletonVertices.value[childIndex * 4 + 3];

          skeletonVertices.value[childIndex * 4] += deltaX;
          skeletonVertices.value[childIndex * 4 + 1] += deltaY;
          skeletonVertices.value[childIndex * 4 + 2] += deltaX;
          skeletonVertices.value[childIndex * 4 + 3] += deltaY;

          if (rotationAngle !== 0) {
            const rotatedHead = rotatePoint(pivotX, pivotY, childHeadX, childHeadY, rotationAngle);
            const rotatedTail = rotatePoint(pivotX, pivotY, childTailX, childTailY, rotationAngle);
            skeletonVertices.value[childIndex * 4] = rotatedHead.x;
            skeletonVertices.value[childIndex * 4 + 1] = rotatedHead.y;
            skeletonVertices.value[childIndex * 4 + 2] = rotatedTail.x;
            skeletonVertices.value[childIndex * 4 + 3] = rotatedTail.y;
          }

          applyTransformToChildren(childIndex, deltaX, deltaY, rotationAngle, pivotX, pivotY);
        });
      }
    };

    
    const setVertexBoneWeight = (vertexIndex, boneIndex, newWeight) => {
      const influences = vertexInfluences.value[vertexIndex];

      if (influences) {
        const influence = influences.find(inf => inf.boneIndex === boneIndex);
        if (influence) {
          influence.weight = newWeight;
          const totalWeight = influences.reduce((sum, inf) => sum + inf.weight, 0);
          if (totalWeight > 0) {
            influences.forEach(inf => inf.weight /= totalWeight);
          }
          updateMeshForSkeletonPose();
        }
      }
    };

    const selectTool = (tool) => {
      if (activeTool.value === 'bone-animate' && tool !== 'bone-animate') {
        resetMeshToOriginal();
        resetSkeletonToOriginal();
      } else if (tool === 'bone-clear') {
        clearBones();
        console.log(" clear bone! ");
      } else if (tool === 'bone-save') {
        saveBones();
      } else if (tool === 'bone-read') {
        readBones();
      }
      activeTool.value = tool;
    };

    const resetSkeletonToOriginal = () => {
      if (originalSkeletonVertices.value.length > 0) {
        skeletonVertices.value = [...originalSkeletonVertices.value];
      }
    };



    // Modified createBuffers to populate transparentCells
    const createBuffers = (gl) => {
      const rows = 10, cols = 10;
      const xStep = 2.0 / (cols - 1);
      const yStep = 2.0 / (rows - 1);

      const visibleCells = [];
      const gridCells = [];

      transparentCells.value.clear();
      for (let y = 0; y < rows - 1; y++) {
        for (let x = 0; x < cols - 1; x++) {
          const cellX = x / (cols - 1);
          const cellY = y / (rows - 1);
          const cellW = 1 / (cols - 1);
          const cellH = 1 / (rows - 1);
          const cellIndex = y * (cols - 1) + x;
          const topLeft = y * cols + x;
          const topRight = y * cols + x + 1;
          const bottomLeft = (y + 1) * cols + x;
          const bottomRight = (y + 1) * cols + x + 1;

          const isTransparent = isAreaTransparent(cellX, cellY, cellW, cellH, imageData, imageWidth, imageHeight);
          if (!isTransparent) {
            visibleCells.push({ x, y });

          } else {
            transparentCells.value.add(cellIndex);
            gridCells.push({
              vertices: [topLeft, topRight, bottomRight, bottomLeft],
              isTransparent: isTransparent
            });
          }
        }
      }

      const usedVertices = new Set();
      visibleCells.forEach(cell => {
        const { x, y } = cell;
        usedVertices.add(y * cols + x);
        usedVertices.add(y * cols + x + 1);
        usedVertices.add((y + 1) * cols + x);
        usedVertices.add((y + 1) * cols + x + 1);
      });

      const vertexMapping = new Map();
      let newIndex = 0;
      const currentVertices = [];
      const currentIndices = [];
      const currentLinesIndices = [];

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const originalIndex = y * cols + x;
          if (usedVertices.has(originalIndex)) {
            vertexMapping.set(originalIndex, newIndex++);
            currentVertices.push(
              -1.0 + x * xStep,
              1.0 - y * yStep,
              x / (cols - 1),
              y / (rows - 1)
            );
          }
        }
      }

      for (let y = 0; y < rows - 1; y++) {
        for (let x = 0; x < cols - 1; x++) {
          const cellX = x / (cols - 1);
          const cellY = y / (rows - 1);
          const cellW = 1 / (cols - 1);
          const cellH = 1 / (rows - 1);
          if (!isAreaTransparent(cellX, cellY, cellW, cellH, imageData, imageWidth, imageHeight)) {
            const topLeft = y * cols + x;
            const topRight = y * cols + x + 1;
            const bottomLeft = (y + 1) * cols + x;
            const bottomRight = (y + 1) * cols + x + 1;
            const newTopLeft = vertexMapping.get(topLeft);
            const newTopRight = vertexMapping.get(topRight);
            const newBottomLeft = vertexMapping.get(bottomLeft); // Note: assuming typo, should be bottomLeft
            const newBottomRight = vertexMapping.get(bottomRight); // Note: assuming typo, should be bottomRight
            currentIndices.push(
              newTopLeft, newBottomLeft, newTopRight,
              newTopRight, newBottomLeft, newBottomRight
            );
          }
        }
      }

      for (const originalIndex1 of usedVertices) {
        if (originalIndex1 % cols < cols - 1) {
          const originalIndex2 = originalIndex1 + 1;
          if (usedVertices.has(originalIndex2)) {
            currentLinesIndices.push(
              vertexMapping.get(originalIndex1),
              vertexMapping.get(originalIndex2)
            );
          }
        }
        if (Math.floor(originalIndex1 / cols) < rows - 1) {
          const originalIndex2 = originalIndex1 + cols;
          if (usedVertices.has(originalIndex2)) {
            currentLinesIndices.push(
              vertexMapping.get(originalIndex1),
              vertexMapping.get(originalIndex2)
            );
          }
        }
      }

      vertices.value = currentVertices;
      originalVertices.value = [...currentVertices];
      indices.value = currentIndices;
      linesIndices.value = currentLinesIndices;
      // 將 gridCells 儲存到某個可訪問的地方，例如 ref
      gridCells.value = gridCells;

      vbo.value = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);

      ebo.value = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo.value);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);

      eboLines.value = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines.value);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);
    };

    const createSkeletonBuffers = (gl) => {
      const skeletonVerticesArray = [];
      const skeletonIndicesArray = [];

      for (let i = 0; i < skeletonVertices.value.length; i += 4) {
        const headX = skeletonVertices.value[i];
        const headY = skeletonVertices.value[i + 1];
        const tailX = skeletonVertices.value[i + 2];
        const tailY = skeletonVertices.value[i + 3];

        const baseIndex = skeletonVerticesArray.length / 2;
        skeletonVerticesArray.push(headX, headY, tailX, tailY);
        skeletonIndicesArray.push(baseIndex, baseIndex + 1);
      }

      const skeletonVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, skeletonVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(skeletonVerticesArray), gl.DYNAMIC_DRAW);

      const skeletonEbo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skeletonEbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(skeletonIndicesArray), gl.STATIC_DRAW);

      return { skeletonVbo, skeletonEbo, skeletonVerticesArray, skeletonIndicesArray };
    };

    const calculateDistance = (x1, y1, x2, y2) => Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const calculateAngle = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
    const rotatePoint = (cx, cy, x, y, angle) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dx = x - cx;
      const dy = y - cy;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return { x: rx + cx, y: ry + cy };
    };
    const distanceFromPointToSegment = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax;
      const dy = by - ay;
      const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      const clampedT = Math.max(0, Math.min(1, t));
      const nearestX = ax + clampedT * dx;
      const nearestY = ay + clampedT * dy;
      return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Shift') {
        isShiftPressed.value = true;
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Shift') {
        isShiftPressed.value = false;
      }
    };

    const setupCanvasEvents = (canvas, gl, container)=> {
      let isDragging = false;
      let localSelectedVertex = -1;
      let startPosX = 0;
      let startPosY = 0;

      const handleMouseDown = (e) => {
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);
        startPosX = xNDC;
        startPosY = yNDC;

        if (e.button === 0 || e.button === 2) {
          if (activeTool.value === 'grab-point') {
            let minDist = Infinity;
            localSelectedVertex = -1;
            for (let i = 0; i < vertices.value.length; i += 4) {
              const dx = vertices.value[i] - xNDC;
              const dy = vertices.value[i + 1] - yNDC;
              const dist = dx * dx + dy * dy;
              if (dist < minDist) {
                minDist = dist;
                localSelectedVertex = i / 4;
              }
            }
            if (minDist < 0.02) {
              isDragging = true;
              selectedVertex.value = localSelectedVertex;
            }
          } else if (activeTool.value === 'bone-create') {
            isDragging = true;
            isEditingExistingBone.value = false;
            selectedBoneForEditing.value = -1;
            editingBoneEnd.value = null;

            for (let i = 0; i < skeletonVertices.value.length; i += 4) {
              const headX = skeletonVertices.value[i];
              const headY = skeletonVertices.value[i + 1];
              const tailX = skeletonVertices.value[i + 2];
              const tailY = skeletonVertices.value[i + 3];

              const distToHead = calculateDistance(xNDC, yNDC, headX, headY);
              const distToTail = calculateDistance(xNDC, yNDC, tailX, tailY);

              if (distToHead < 0.1) {
                selectedBoneForEditing.value = i / 4;
                editingBoneEnd.value = 'head';
                isEditingExistingBone.value = true;
                parentBoneIndex = boneParents.value[i / 4];
                break;
              } else if (distToTail < 0.1) {
                selectedBoneForEditing.value = i / 4;
                editingBoneEnd.value = 'tail';
                isEditingExistingBone.value = true;
                parentBoneIndex = i / 4;
                break;
              }
            }

            if (!isEditingExistingBone.value) {
              const newBoneIndex = lineIndex;
              console.log(" line index: ", lineIndex);
              if (newBoneIndex === 0) {
                console.log("first bone!");
                parentBoneIndex = -1;
                boneParents.value.push(parentBoneIndex);
                skeletonVertices.value.push(xNDC, yNDC, xNDC, yNDC);
              } else {
                boneParents.value.push(parentBoneIndex);
                if (isShiftPressed.value) {
                  console.log(" hi shift parent Bone index: ", parentBoneIndex);
                  const parentTailX = skeletonVertices.value[parentBoneIndex * 4 + 2];
                  const parentTailY = skeletonVertices.value[parentBoneIndex * 4 + 3];
                  skeletonVertices.value.push(parentTailX, parentTailY, parentTailX, parentTailY);
                } else {
                  skeletonVertices.value.push(xNDC, yNDC, xNDC, yNDC);
                }
              }

              if (skeletonIndices.value.length <= newBoneIndex * 2) {
                skeletonIndices.value.push(newBoneIndex * 2, newBoneIndex * 2 + 1);
              }
              parentBoneIndex = newBoneIndex;
            }
          } else if (activeTool.value === 'bone-animate') {
            let minDistToSegment = Infinity;
            selectedBone.value = -1;
            boneEndBeingDragged.value = null;

            for (let i = 0; i < skeletonVertices.value.length; i += 4) {
              const headX = skeletonVertices.value[i];
              const headY = skeletonVertices.value[i + 1];
              const tailX = skeletonVertices.value[i + 2];
              const tailY = skeletonVertices.value[i + 3];

              let dx = headX - xNDC;
              let dy = headY - yNDC;
              let dist = dx * dx + dy * dy;
              if (dist < 0.001) {
                selectedBone.value = i / 4;
                boneEndBeingDragged.value = 'head';
                break;
              }

              dx = tailX - xNDC;
              dy = tailY - yNDC;
              dist = dx * dx + dy * dy;
              if (dist < 0.001) {
                selectedBone.value = i / 4;
                boneEndBeingDragged.value = 'tail';
                break;
              }

              const distToSegment = distanceFromPointToSegment(xNDC, yNDC, headX, headY, tailX, tailY);
              if (distToSegment < 0.1 && distToSegment < minDistToSegment) {
                minDistToSegment = distToSegment;
                selectedBone.value = i / 4;
                boneEndBeingDragged.value = 'middle';
              }
            }

            if (selectedBone.value >= 0) {
              isDragging = true;
              if (originalSkeletonVertices.value.length === 0) {
                originalSkeletonVertices.value = [...skeletonVertices.value];
              }
            }
          }
        }
      };

      const handleMouseMove = (e) => {
        if (!isDragging) return;
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);

        if (activeTool.value === 'grab-point' && localSelectedVertex !== -1) {
          const index = localSelectedVertex * 4;
          vertices.value[index] = xNDC;
          vertices.value[index + 1] = yNDC;
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
          gl.bufferSubData(gl.ARRAY_BUFFER, index * 4, new Float32Array([xNDC, yNDC]));
        } else if (activeTool.value === 'bone-create') {
          if (isEditingExistingBone.value && selectedBoneForEditing.value >= 0 && editingBoneEnd.value) {
            const boneIndex = selectedBoneForEditing.value;
            if (editingBoneEnd.value === 'head') {
              skeletonVertices.value[boneIndex * 4] = xNDC;
              skeletonVertices.value[boneIndex * 4 + 1] = yNDC;
            } else if (editingBoneEnd.value === 'tail') {
              skeletonVertices.value[boneIndex * 4 + 2] = xNDC;
              skeletonVertices.value[boneIndex * 4 + 3] = yNDC;
            }
          } else {
            skeletonVertices.value[lineIndex * 4 + 2] = xNDC;
            skeletonVertices.value[lineIndex * 4 + 3] = yNDC;
          }
        } else if (activeTool.value === 'bone-animate' && selectedBone.value >= 0) {
          const boneIndex = selectedBone.value;
          if (boneEndBeingDragged.value === 'middle' || boneEndBeingDragged.value === 'tail') {
            if (e.buttons === 2) {
              const deltaX = xNDC - startPosX;
              const deltaY = yNDC - startPosY;
              skeletonVertices.value[boneIndex * 4] += deltaX;
              skeletonVertices.value[boneIndex * 4 + 1] += deltaY;
              skeletonVertices.value[boneIndex * 4 + 2] += deltaX;
              skeletonVertices.value[boneIndex * 4 + 3] += deltaY;
              applyTransformToChildren(boneIndex, deltaX, deltaY, 0, 0, 0);
              startPosX = xNDC;
              startPosY = yNDC;
            } else if (e.buttons === 1) {
              const headX = skeletonVertices.value[boneIndex * 4];
              const headY = skeletonVertices.value[boneIndex * 4 + 1];
              const prevAngle = Math.atan2(startPosY - headY, startPosX - headX);
              const currentAngle = Math.atan2(yNDC - headY, xNDC - headX);
              const rotationAngle = currentAngle - prevAngle;

              const tailX = skeletonVertices.value[boneIndex * 4 + 2];
              const tailY = skeletonVertices.value[boneIndex * 4 + 3];
              const rotatedTail = rotatePoint(headX, headY, tailX, tailY, rotationAngle);
              skeletonVertices.value[boneIndex * 4 + 2] = rotatedTail.x;
              skeletonVertices.value[boneIndex * 4 + 3] = rotatedTail.y;

              applyTransformToChildren(boneIndex, 0, 0, rotationAngle, headX, headY);
              startPosX = xNDC;
              startPosY = yNDC;
            }
          }
          updateMeshForSkeletonPose();
        }
      };

      const handleMouseUp = () => {
        if (activeTool.value === 'bone-create' && isDragging) {
          if (!isEditingExistingBone.value) {
            const newBoneIndex = lineIndex;
            const headX = skeletonVertices.value[newBoneIndex * 4];
            const headY = skeletonVertices.value[newBoneIndex * 4 + 1];
            const tailX = skeletonVertices.value[newBoneIndex * 4 + 2];
            const tailY = skeletonVertices.value[newBoneIndex * 4 + 3];
            const distance = Math.sqrt((tailX - headX) ** 2 + (tailY - headY) ** 2);

            if (distance < minBoneLength) {
              parentBoneIndex = boneParents.value[parentBoneIndex];
              skeletonVertices.value.splice(newBoneIndex * 4, 4);
              boneParents.value.pop();
            } else {
              const parentIndex = boneParents.value[newBoneIndex];
              if (parentIndex !== -1) {
                if (!boneChildren.value[parentIndex]) {
                  boneChildren.value[parentIndex] = [];
                }
                boneChildren.value[parentIndex].push(newBoneIndex);
              }
              lineIndex++;
              const newBoneStart = newBoneIndex * 4;
              originalSkeletonVertices.value.push(
                skeletonVertices.value[newBoneStart],
                skeletonVertices.value[newBoneStart + 1],
                skeletonVertices.value[newBoneStart + 2],
                skeletonVertices.value[newBoneStart + 3]
              );
              computeVertexInfluences();
            }
          }
        }

        isDragging = false;
        selectedVertex.value = -1;
        boneEndBeingDragged.value = null;
        selectedBoneForEditing.value = -1;
        editingBoneEnd.value = null;
        isEditingExistingBone.value = false;
      };

      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);

      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('mouseleave', handleMouseUp);

      canvas.tabIndex = 1;
      canvas.addEventListener('focus', () => {
        canvas.style.outline = 'none';
      });
    };

    const render = (gl, program, colorProgram, skeletonProgram) => {
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (texture.value) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo.value);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture.value);
        gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);

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

      if (skeletonVertices.value.length > 0) {
        gl.useProgram(skeletonProgram);
        const { skeletonVbo, skeletonEbo, skeletonVerticesArray, skeletonIndicesArray } = createSkeletonBuffers(gl);

        const skeletonPosAttrib = gl.getAttribLocation(skeletonProgram, 'aPosition');
        gl.enableVertexAttribArray(skeletonPosAttrib);
        gl.bindBuffer(gl.ARRAY_BUFFER, skeletonVbo);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 0, 1, 0, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skeletonEbo);
        gl.drawElements(gl.LINES, skeletonIndicesArray.length, gl.UNSIGNED_SHORT, 0);

        if (selectedBone.value >= 0) {
          const parentIndex = boneParents.value[selectedBone.value];
          if (parentIndex >= 0) {
            const parentStart = parentIndex * 2;
            gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 0, 0, 1, 1);
            gl.drawElements(gl.LINES, 2, gl.UNSIGNED_SHORT, parentStart * 2);
          }

          const selectedStart = selectedBone.value * 2;
          gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 0, 0, 1);
          gl.drawElements(gl.LINES, 2, gl.UNSIGNED_SHORT, selectedStart * 2);
        }

        gl.uniform1f(gl.getUniformLocation(skeletonProgram, 'uPointSize'), 7.0);
        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 1, 0, 1);
        const headVertices = [];
        for (let i = 0; i < skeletonVerticesArray.length; i += 4) {
          headVertices.push(skeletonVerticesArray[i], skeletonVerticesArray[i + 1]);
        }
        const headVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, headVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(headVertices), gl.STATIC_DRAW);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, headVertices.length / 2);

        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 0, 0.5, 1, 1);
        const tailVertices = [];
        for (let i = 0; i < skeletonVerticesArray.length; i += 4) {
          tailVertices.push(skeletonVerticesArray[i + 2], skeletonVerticesArray[i + 3]);
        }
        const tailVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tailVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tailVertices), gl.STATIC_DRAW);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, tailVertices.length / 2);
      }

      requestAnimationFrame(() => render(gl, program, colorProgram, skeletonProgram));
    };

   

   

    onMounted(async () => {
      const canvas = document.getElementById('webgl');
      const container = canvas.closest('.image-container');
      const webglContext = canvas.getContext('webgl');
      gl.value = webglContext;

      program.value = createProgram(webglContext, shaders.vertex, shaders.fragment);
      colorProgram.value = createProgram(webglContext, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = createProgram(webglContext, shaders.skeletonVertex, shaders.skeletonFragment);

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      try {
        texture.value = await loadTexture(webglContext, './png3.png', imageData, imageWidth, imageHeight);
        createBuffers(webglContext);
        setupCanvasEvents(canvas, webglContext, container);
        render(webglContext, program.value, colorProgram.value, skeletonProgram.value);
      } catch (error) {
        console.error("Initialization error:", error);
      }
    });

    return {
      selectTool,
      activeTool,
      setVertexBoneWeight,
      clearBones,
      saveBones,
      readBones,
      resetMeshToOriginal, 
      updateMeshForSkeletonPose 
    };

  }

});

// 掛載應用
export default app;
