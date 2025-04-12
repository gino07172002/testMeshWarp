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
  readBones,
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
  gridCells,
  transparentCells,
  isAreaTransparent,
  imageData,
  imageWidth,
  imageHeight,

} from './useWebGL.js';


import gls from './useWebGL.js'; // 導入 GLS 類
import bones from './useBone.js'
import Timeline from './timeline.js';

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



const app = Vue.createApp({
  data() {
    return {
      imageData: '',
      lastTimestamp: 0,
      status: '準備中',
      points: [],
      fileDropdown: false,
      editDropdown: false,
      selectedLayerId: null,
      layers: [],
      layerCounter: 0,
      keyframeCounter: 0,
      isDragging: false,
      startX: 0,
      scrollLeft: 0,
      dragStartX: 0,
      dragStartY: 0,
      fileDropdown: false,
      editDropdown: false,
      selectedLayerId: null,
      layerCounter: 0,
      keyframeCounter: 0,
      isDragging: false,
      startX: 0,
      scrollLeft: 0,
      playheadPosition: 0, // 播放頭位置
      timelineLength: 1000, // 時間軸總長度 (px)
      isPlaying: false, // 是否正在播放
      animationStartTime: null, // 動畫開始時間
      timeline: null,
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
    this.timeline = new Timeline();
  },
  computed: {
    keyframes() {
      return this.timeline?.keyframes || [];
    },
    boneTree() {
      // 找到所有根骨頭（無父骨頭的骨頭）
      const rootBones = boneParents.value
        .map((parent, index) => (parent === -1 ? index : null))
        .filter(index => index !== null);
      // 對每個根骨頭構建樹形結構
      return rootBones.map(rootIndex => this.buildBoneTree(rootIndex));
    }
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
    addKeyframe() {
      console.log(" hi key frame ");
      this.timeline.addKeyframe();
    },
    selectKeyframe(id) {
      this.timeline.selectKeyframe(id);

    },
    playAnimation() {
      this.timeline.playAnimation();
    },
    stopAnimation() {
      this.timeline.stopAnimation();
    },
    startDrag(e) {
      this.timeline.startDrag(e, this.$refs.timelineTracks);
    },
    onDrag(e) {
      this.timeline.onDrag(e, this.$refs.timelineTracks);
    },
    stopDrag() {
      this.timeline.stopDrag();
    },
    addTimelineComponent() {
      alert('新增時間軸元件功能觸發');
    },


    // 將專案儲存到伺服器的API示例
    saveProjectToServer() {
      this.status = '正在儲存專案...';

      const projectData = {
        layers: this.layers,
        keyframes: timeline.keyframes,
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
    },
    buildBoneTree(boneIndex) {
      console.log(`Building tree for bone ${boneIndex}`);
      const boneId = `bone${boneIndex}`;
      const boneName = `Bone ${boneIndex}`;
      const children = boneChildren.value[boneIndex] || [];
      console.log(`Children of bone ${boneIndex}:`, children);
      return {
        id: boneId,
        name: boneName,
        children: children.map(childIndex => this.buildBoneTree(childIndex))
      };
    },
    toggleNode(nodeId) {
      if (this.expandedNodes.includes(nodeId)) {
        this.expandedNodes = this.expandedNodes.filter(id => id !== nodeId);
      } else {
        this.expandedNodes.push(nodeId);
      }
    },
    handleNameClick(name) {
      const boneIndex = parseInt(name.split(' ')[1]); // 從 "Bone 0" 中提取索引
      selectedBoneForEditing.value = boneIndex; // 設置選中的骨頭
      console.log('Selected bone for editing:', boneIndex);
    },
  },
  setup() {
    // const gl = ref(null);
    const selectedVertex = ref(-1);
    const activeTool = ref('grab-point');

    const skeletonIndices = ref([]);
    const selectedBone = ref(-1);
    const boneEndBeingDragged = ref(null);
    const isShiftPressed = ref(false);
    var parentBoneIndex = -1;
    var lineIndex = 0;
    const minBoneLength = 0.1;

    const glsInstance = new gls();
    const bonesInstance = new bones();




    const selectTool = (tool) => {
      if (activeTool.value === 'bone-animate' && tool !== 'bone-animate') {
        glsInstance.resetMeshToOriginal();
        bonesInstance.resetSkeletonToOriginal();
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
    const handleKeyDown = (e) => {
      if (e.key === 'Shift') {
        console.log(" hi shift!");
        isShiftPressed.value = true;
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Shift') {
        console.log("bye shift");
        isShiftPressed.value = false;
      }
    };

    const setupCanvasEvents = (canvas, gl, container) => {
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

              const distToHead = bonesInstance.calculateDistance(xNDC, yNDC, headX, headY);
              const distToTail = bonesInstance.calculateDistance(xNDC, yNDC, tailX, tailY);


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

              const distToSegment = glsInstance.distanceFromPointToSegment(xNDC, yNDC, headX, headY, tailX, tailY);
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
              bonesInstance.applyTransformToChildren(boneIndex, deltaX, deltaY, 0, 0, 0);
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
              const rotatedTail = bonesInstance.rotatePoint(headX, headY, tailX, tailY, rotationAngle);
              skeletonVertices.value[boneIndex * 4 + 2] = rotatedTail.x;
              skeletonVertices.value[boneIndex * 4 + 3] = rotatedTail.y;

              bonesInstance.applyTransformToChildren(boneIndex, 0, 0, rotationAngle, headX, headY);
              startPosX = xNDC;
              startPosY = yNDC;
            }
          }
          glsInstance.updateMeshForSkeletonPose();
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
              glsInstance.computeVertexInfluences();
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
        const { skeletonVbo, skeletonEbo, skeletonVerticesArray, skeletonIndicesArray } = glsInstance.createSkeletonBuffers(gl);

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

      program.value = glsInstance.createProgram(webglContext, shaders.vertex, shaders.fragment);
      colorProgram.value = glsInstance.createProgram(webglContext, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = glsInstance.createProgram(webglContext, shaders.skeletonVertex, shaders.skeletonFragment);

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      try {
        texture.value = await loadTexture(webglContext, './png3.png', imageData, imageWidth, imageHeight);
        glsInstance.createBuffers(webglContext);

        setupCanvasEvents(canvas, webglContext, container);
        render(webglContext, program.value, colorProgram.value, skeletonProgram.value);
        initBone(gl, program, texture, vbo, ebo, indices, glsInstance.resetMeshToOriginal, glsInstance.updateMeshForSkeletonPose);

      } catch (error) {
        console.error("Initialization error:", error);
      }
    });

    return {
      selectTool,
      clearBones,
      saveBones,
      readBones,
      activeTool
    };

  }

});
const TreeItem = {
  props: ['node', 'expandedNodes'],
  template: `
   <div class="tree-item">
      <div class="tree-item-header">
        <span class="tree-toggle-icon" 
              :class="{ 'expanded': expandedNodes.includes(node.id) }" 
              @click.stop="toggleNode(node.id)" 
              v-if="node.children && node.children.length > 0">▶</span>
        <span class="tree-item-name" 
              @click.stop="handleNameClick(node.name)">{{ node.name }}</span>
      </div>
      <div class="tree-children" 
           v-if="expandedNodes.includes(node.id)">
        <tree-item 
          v-for="child in node.children" 
          :key="child.id" 
          :node="child" 
          :expanded-nodes="expandedNodes" 
          @toggle-node="toggleNode" 
          @name-click="handleNameClick">
        </tree-item>
      </div>
    </div>
  `,
  methods: {
    toggleNode(nodeId) {
      console.log('Toggling node:', nodeId);
      this.$emit('toggle-node', nodeId);
    },
    handleNameClick(name) {
      console.log('Clicked name:', name);
      this.$emit('name-click', name);
    }
  }
};

// 在主組件中註冊
app.component('tree-item', TreeItem);
// 掛載應用
export default app;
