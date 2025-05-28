const { createApp, onMounted, ref, reactive } = Vue;
export const selectedBone = ref(-1);
export const boneIdToIndexMap = reactive({});
export const boneTree = reactive({});
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
  boneEndBeingDragged,
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
  vbo2,
  ebo2,
  eboLines2,
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

import {
  psdHello,
  processPSDFile,
  allLayers,
  drawSelectedLayers

} from './psd.js';

import glsInstance from './useWebGL.js';
import Bones from './useBone.js';
import Timeline from './timeline.js';
import ImageCanvasManager from './ImageCanvasManager.js';

// Shader sources
const shaders = {
  vertex: `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;
        varying vec2 vTexCoord;
        uniform mat4 uTransform;
        void main() {
          gl_Position = uTransform * vec4(aPosition, 0.0, 1.0);
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

  const x = e.clientX - rect.left + scrollLeft;
  const y = e.clientY - rect.top + scrollTop;

  const scaleX = canvas.width / container.clientWidth;
  const scaleY = canvas.height / container.clientHeight;

  const canvasX = x * scaleX;
  const canvasY = y * scaleY;

  return {
    x: (canvasX / canvas.width) * 2 - 1,
    y: 1 - (canvasY / canvas.height) * 2
  };
};
const changeImage = async (newUrl) => {
  if (!gl.value) return;

  // 刪除舊紋理釋放資源
  if (texture.value) {
    gl.value.deleteTexture(texture.value.tex);
    texture.value = null;
  }

  try {
    // 載入新圖片並更新紋理
    let result = await loadTexture(gl.value, newUrl);
    texture.value = { tex: result.texture };
    imageData.value = result.data;
    imageWidth.value = result.width;
    imageHeight.value = result.height;
    // 根據新圖片尺寸重新建立頂點緩衝
    glsInstance.createBuffers(gl.value);

    // 若骨架數據與圖片相關，需重新初始化
   // initBone(gl, program, texture.tex, vbo, ebo, indices, glsInstance.resetMeshToOriginal, glsInstance.updateMeshForSkeletonPose);
   initBone(gl, program, texture.tex, vbo ,ebo, indices, glsInstance.resetMeshToOriginal, glsInstance.updateMeshForSkeletonPose);

  } catch (error) {
    console.error("更換圖片失敗:", error);
  }
};

const changeImage2 = async (layerIndices = null) => {
  if (!gl.value) return;

  // 刪除舊紋理釋放資源
  if (texture.value) {
    if (Array.isArray(texture.value.tex)) {
      texture.value.forEach(tex => gl.value.deleteTexture(tex));
    } else {
      gl.value.deleteTexture(texture.value.tex);
    }
    texture.value = null;
  }

  try {


    //console.log(" test all layer ", JSON.stringify(allLayers));
    // 確定要渲染的圖層：如果未傳入 layerIndices，則渲染所有圖層
    const layersToRender = layerIndices ? layerIndices.map(index => allLayers[index]) : allLayers;

    console.log(" hi layer length : ",allLayers.length);

    // 為每個圖層創建紋理，並存儲為數組
    texture.value = await Promise.all(layersToRender.map(layer => layerToTexture(gl.value, layer)));

    console.log(" hi texture : ", texture.value);
    // 根據新圖片尺寸重新建立頂點緩衝（假設所有圖層共享相同網格）
    glsInstance.createBuffers(gl.value);

    // 若骨架數據與圖片相關，需重新初始化
    initBone(gl, program, texture.tex, vbo, ebo, indices, glsInstance.resetMeshToOriginal, glsInstance.updateMeshForSkeletonPose);

  } catch (error) {
    console.error("更換圖片失敗:", error);
  }
};


const layerToTexture = (gl, layer) => {
  return new Promise((resolve, reject) => {
    // 從圖層中提取必要資料
    const { imageData, width, height } = layer;

    // 檢查資料有效性
    if (!imageData || width <= 0 || height <= 0) {
      reject(new Error('無效的圖層資料'));
      return;
    }

    // 創建並綁定紋理
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // 設置像素儲存參數（翻轉 Y 軸以匹配 PSD 座標系）
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    // 上傳紋理資料
    gl.texImage2D(
      gl.TEXTURE_2D,        // 目標
      0,                    // 詳細級別
      gl.RGBA,             // 內部格式
      width,               // 寬度
      height,              // 高度
      0,                    // 邊框
      gl.RGBA,             // 格式
      gl.UNSIGNED_BYTE,    // 類型
      imageData            // 像素資料
    );

    // 設置紋理參數
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // 解綁紋理
    gl.bindTexture(gl.TEXTURE_2D, null);
    let coords = { top: layer.top, left: layer.left, bottom: layer.bottom, right: layer.right };
    // 解析 Promise，返回紋理
    resolve({ tex: texture, coords: coords, width: layer.width, height: layer.height });
  });
};


// Texture Loading Functions
const loadTexture = (gl, url) => {
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

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = image.width;
      tempCanvas.height = image.height;
      const tempCtx = tempCanvas.getContext('2d');

      tempCtx.drawImage(image, 0, 0);

      const imgData = tempCtx.getImageData(0, 0, image.width, image.height);

      gl.bindTexture(gl.TEXTURE_2D, null);


      resolve({
        texture: currentTexture,      // WebGL紋理物件
        data: imgData.data,            // 圖像的像素數據 (Uint8Array)
        width: image.width,            // 圖像寬度
        height: image.height           // 圖像高度
      });
    };

    image.onerror = (error) => {
      console.error("Image loading failed:", error);
      reject(error);
    };

    image.src = url;
  });
};

const app = Vue.createApp({
  data() {
    return {
      imageData: '',
      imageCanvasManager: null,
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
      timelineLength: 1000,
      dragInfo: { dragging: false, startX: 0, type: null },
      timeSelection: { active: false, start: 0, end: 0 },
      animationPlaying: false,
      animationStartTime: 0,
      nextKeyframeId: 10,
      psdLayers: [],
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
  async mounted() {
    this.addLayer();
    console.log("somehow mount here ... ");
  },
  beforeUnmount() {
  },
  computed: {
    keyframes() {
      return this.timeline?.keyframes || [];
    },
    timeRange() {
      return this.timeline?.timeRange || { qq: 123 };
    },
    boneTree() {
      const rootBones = boneParents.value
        .map((parent, index) => (parent === -1 ? index : null))
        .filter(index => index !== null);

      Object.keys(boneIdToIndexMap).forEach(key => {
        delete boneIdToIndexMap[key];
      });

      const trees = rootBones.map(rootIndex => {
        const tree = this.buildBoneTree(rootIndex, null, boneIdToIndexMap);
        return tree;
      });

      Object.keys(boneTree).forEach(key => {
        delete boneTree[key];
      });

      trees.forEach((tree, index) => {
        boneTree[index] = tree;
      });

      return trees;
    },
    flattenedBones() {
      let result = [];
      this.boneTree.forEach(root => {
        this.timeline.getFlattenedBones(root, 0, result);
      });
      return result;
    }
  },
  beforeUnmount() {
    clearInterval(this.updateTimer);
  },
  unmounted() {
    document.removeEventListener('click', this.handleClickOutside);
  },
  methods: {
    addLayer() {
      this.layerCounter++;
      const newLayer = {
        id: this.layerCounter,
        name: `圖層 ${this.layerCounter}`
      };
      this.layers.push(newLayer);
      this.status = `新增圖層: ${newLayer.name}`;
    },
    selectLayer(id) {
      this.selectedLayerId = id;
      const layer = this.layers.find(l => l.id === id);
      if (layer) {
        this.status = `選擇圖層: ${layer.name} , id = ${id}`;
      }
    },
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
    selectBone(bone) {
      this.selectedBone = bone;
      this.selectedKeyframe = null;
    },
    selectKeyframe(boneId, keyframeId) {
      const bone = this.flattenedBones.find(b => b.id === boneId);
      if (bone) {
        this.selectedBone = bone;
        this.selectedKeyframe = this.timeline.keyframes[boneId]?.find(k => k.id === keyframeId) || null;
      }
    },
    testCountFn() {
      console.log(" in app testCountFn");
      this.timeline.testCount++;
      psdHello();

    },
    changeImageTest() {
      changeImage('./png2.png');
    },
    changeImageTest2() {
      changeImage2();
    }
    ,
    usePsd() {
      console.log("hello use psd ... ");
      psdHello();
      console.log("ok use psd ... ");

      // then I should draw layers to canvas
    },
    createLayerTexture(gl, layer) {
      if (!layer || !layer.imageData) {
        console.error("Layer or layer.imageData is undefined:", layer);
        return null;
      }

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);

      console.log("Processing layer:", layer.name, "ImageData type:", Object.prototype.toString.call(layer.imageData));

      // Handle different types of imageData
      if (layer.imageData instanceof ImageData) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, layer.imageData.width, layer.imageData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, layer.imageData.data);
      } else if (layer.imageData instanceof HTMLCanvasElement || layer.imageData instanceof HTMLImageElement) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.imageData);
      } else if (ArrayBuffer.isView(layer.imageData)) {
        // Handle Uint8Array, Uint8ClampedArray etc.
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = layer.width;
        tempCanvas.height = layer.height;
        const tempCtx = tempCanvas.getContext('2d');
        const tempImageData = tempCtx.createImageData(layer.width, layer.height);
        tempImageData.data.set(layer.imageData);
        tempCtx.putImageData(tempImageData, 0, 0);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tempCanvas);
      } else {
        console.error("Unsupported layer.imageData type for layer:", layer.name, layer.imageData);
        console.log("Data preview:", layer.imageData && layer.imageData.length ? layer.imageData.slice(0, 20) : "No data");
        return null;
      }

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      return texture;
    },

    async handlePSDUpload(event) {
      try {
        const file = event.target.files[0];
        if (file) {
          await processPSDFile(file);
          this.psdLayers = allLayers;

          const glContext = gl.value; // WebGL context from useWebGL.js

          for (const layer of this.psdLayers) {
            // Create texture for the layer
            layer.texture = this.createLayerTexture(glContext, layer);

            // Calculate NDC coordinates based on layer position and size
            const left = layer.left || 0;
            const top = layer.top || 0;
            const right = left + (layer.width || imageWidth.value);
            const bottom = top + (layer.height || imageHeight.value);

            const ndcLeft = (left / imageWidth.value) * 2 - 1;
            const ndcRight = (right / imageWidth.value) * 2 - 1;
            const ndcTop = 1 - (top / imageHeight.value) * 2;
            const ndcBottom = 1 - (bottom / imageHeight.value) * 2;

            // Define vertices for the quad (position and texture coordinates)
            const layerVertices = [
              ndcLeft, ndcBottom, 0, 0,   // Bottom-left
              ndcRight, ndcBottom, 1, 0,  // Bottom-right
              ndcRight, ndcTop, 1, 1,     // Top-right
              ndcLeft, ndcTop, 0, 1       // Top-left
            ];

            // Create and populate vertex buffer object (VBO)
            layer.vbo = glContext.createBuffer();
            glContext.bindBuffer(glContext.ARRAY_BUFFER, layer.vbo);
            glContext.bufferData(glContext.ARRAY_BUFFER, new Float32Array(layerVertices), glContext.STATIC_DRAW);

            // Create and populate element buffer object (EBO) for triangles
            layer.ebo = glContext.createBuffer();
            glContext.bindBuffer(glContext.ELEMENT_ARRAY_BUFFER, layer.ebo);
            glContext.bufferData(glContext.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), glContext.STATIC_DRAW);
            //  console.log(" layer : ",JSON.stringify(layer));
          }

          console.log(" then renew canvas... ");
          // No need to call drawSelectedLayers() here; rendering is handled in the render loop
        }
      } catch (error) {
        console.error("處理 PSD 檔案時出錯:", error);
      }
    },
    saveProjectToServer() {
      this.status = '正在儲存專案...';
      const projectData = {
        layers: this.layers,
        keyframes: this.timeline.keyframes,
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
        });
    },
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
        });
    },
    handleClickOutside(e) {
      const targetElement = e.target;
      if (!targetElement.closest('.menu-item')) {
        this.closeAllDropdowns();
      }
    },
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
    buildBoneTree(boneIndex, parentId = null, boneIdToIndexMap = {}) {
      const boneId = `bone${boneIndex}`;
      const boneName = `Bone ${boneIndex}`;
      const index = boneIndex;

      boneIdToIndexMap[boneId] = boneIndex;

      const headX = skeletonVertices.value[boneIndex * 4];
      const headY = skeletonVertices.value[boneIndex * 4 + 1];
      const tailX = skeletonVertices.value[boneIndex * 4 + 2];
      const tailY = skeletonVertices.value[boneIndex * 4 + 3];

      const children = boneChildren.value[boneIndex] || [];
      return {
        id: boneId,
        name: boneName,
        parentId: parentId,
        index: boneIndex,
        head: { x: Math.round(headX * 100) / 100, y: Math.round(headY * 100) / 100 },
        tail: { x: Math.round(tailX * 100) / 100, y: Math.round(tailY * 100) / 100 },
        children: children.map(childIndex => this.buildBoneTree(childIndex, boneId, boneIdToIndexMap))
      };
    },
    getParentBoneById(boneId) {
      const targetBone = this.flattenedBones.find(b => b.id === boneId);
      if (!targetBone?.parentId) return null;
      return this.flattenedBones.find(b => b.id === targetBone.parentId);
    },
    getChildBonesById(boneId) {
      const targetBone = this.flattenedBones.find(b => b.id === boneId);
      if (!targetBone?.childIds?.length) return [];
      return this.flattenedBones.filter(b => targetBone.childIds.includes(b.id));
    },
    toggleNode(nodeId) {
      if (this.expandedNodes.includes(nodeId)) {
        this.expandedNodes = this.expandedNodes.filter(id => id !== nodeId);
      } else {
        this.expandedNodes.push(nodeId);
      }
    },
    handleNameClick(boneIndex) {
      this.selectedBone = { index: boneIndex };
    },
    showBone() {
      console.log("hi show bone");
      console.log("hi bone ", JSON.stringify(this.boneTree));
    }
  },
  setup() {
    const selectedVertex = ref(-1);
    const activeTool = ref('grab-point');
    const skeletonIndices = ref([]);
    const isShiftPressed = ref(false);
    const instance = Vue.getCurrentInstance();

    const timeline = reactive(new Timeline({
      onUpdate: () => instance.proxy.$forceUpdate(),
      vueInstance: instance,
      updateMeshForSkeletonPose: glsInstance.updateMeshForSkeletonPose,
    }));

    const bonesInstance = new Bones({
      onUpdate: () => instance.proxy.$forceUpdate(),
      vueInstance: instance,
      gl: gl.value,
      vertices: vertices,
      vbo: vbo,
      originalVertices: originalVertices,
      selectedBone: selectedBone,
      isShiftPressed: isShiftPressed,
      skeletonIndices: skeletonIndices,
      glsInstance: glsInstance,
    });

    const selectTool = (tool) => {
      activeTool.value = tool;
      console.log("switch to tool : ", tool);
      if (activeTool.value === 'bone-animate') {
        bonesInstance.restoreSkeletonVerticesFromLast();
      }
      else if (tool === 'bone-create') {
        glsInstance.resetMeshToOriginal();
        bonesInstance.resetSkeletonToOriginal();
      }
      else if (tool === 'bone-clear') {
        bonesInstance.clearBones();
        selectedBone.value = {};
      } else if (tool === 'bone-save') {
        bonesInstance.saveBones();
        // bonesInstance.checkKeyframe();
      } else if (tool === 'bone-read') {
        bonesInstance.readBones();
      }
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
            bonesInstance.handleBoneCreateMouseDown(xNDC, yNDC, isShiftPressed.value);
            isDragging = true;
          } else if (activeTool.value === 'bone-animate') {
            bonesInstance.handleBoneAnimateMouseDown(xNDC, yNDC);
            if (selectedBone.value.index >= 0) {
              isDragging = true;
              startPosX = xNDC;
              startPosY = yNDC;
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
          bonesInstance.handleBoneCreateMouseMove(xNDC, yNDC);
        } else if (activeTool.value === 'bone-animate') {
          bonesInstance.handleBoneAnimateMouseMove(startPosX, startPosY, xNDC, yNDC, e.buttons);
          // console.log(" xNDC: ",xNDC," , yNDC",yNDC);
          startPosX = xNDC;
          startPosY = yNDC;
        }
      };

      const handleMouseUp = () => {
        if (activeTool.value === 'bone-create' && isDragging) {
          bonesInstance.handleBoneCreateMouseUp();
          bonesInstance.assignVerticesToBones();
        } else if (activeTool.value === 'bone-animate' && isDragging) {
          bonesInstance.handleBoneAnimateMouseUp();
        }
        isDragging = false;
        selectedVertex.value = -1;
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

    //render start

    const render = (gl, program, colorProgram, skeletonProgram) => {
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      //gl.clear(gl.COLOR_BUFFER_BIT);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // 渲染紋理
      if (texture.value) {
        const textures = Array.isArray(texture.value) ? texture.value : [texture.value];

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo.value);

        const posAttrib = gl.getAttribLocation(program, 'aPosition');
        const texAttrib = gl.getAttribLocation(program, 'aTexCoord');

        gl.enableVertexAttribArray(posAttrib);
        gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 16, 0);

        gl.enableVertexAttribArray(texAttrib);
        gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 16, 8);

        textures.forEach((tex, index) => {
          const coords = tex.coords || {};
          const left = coords.left !== undefined ? coords.left : -1.0;
          const right = coords.right !== undefined ? coords.right : 1.0;
          const top = coords.top !== undefined ? coords.top : 1.0;
          const bottom = coords.bottom !== undefined ? coords.bottom : -1.0;

          const scaleX = (right - left) / 2.0;
          const scaleY = (top - bottom) / 2.0;
          const translateX = (left + right) / 2.0;
          const translateY = (bottom + top) / 2.0;

          // 創建變換矩陣
          let transformMatrix = [
            scaleX, 0, 0, 0,
            0, scaleY, 0, 0,
            0, 0, 1, 0,
            translateX, translateY, 0, 1
          ];

         // if (index ==1 )
           {
            gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uTransform'), false, transformMatrix);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex.tex);
            gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);
            gl.drawElements(gl.TRIANGLES, indices.value.length, gl.UNSIGNED_SHORT, 0);
          }
        });
      }

      // 渲染基本幾何形狀
      renderBasicGeometry(gl, colorProgram);

      // 渲染骨架
      renderSkeleton(gl, skeletonProgram);

      requestAnimationFrame(() => render(gl, program, colorProgram, skeletonProgram));
    };


    const render2 = (gl, program, colorProgram, skeletonProgram) => {
      
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      //gl.clear(gl.COLOR_BUFFER_BIT);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // 渲染紋理
      if (texture.value) {
       // console.log("render2 length : ",vbo2.value.length);
        const textures = Array.isArray(texture.value) ? texture.value : [texture.value];

        gl.useProgram(program);
        for(let i =0;i<vbo2.value.length;i++)
        {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo2.value[i]);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo2.value[i]);
        }

        const posAttrib = gl.getAttribLocation(program, 'aPosition');
        const texAttrib = gl.getAttribLocation(program, 'aTexCoord');

        gl.enableVertexAttribArray(posAttrib);
        gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 16, 0);

        gl.enableVertexAttribArray(texAttrib);
        gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 16, 8);

        textures.forEach((tex, index) => {
          const coords = tex.coords || {};
          const left = coords.left !== undefined ? coords.left : -1.0;
          const right = coords.right !== undefined ? coords.right : 1.0;
          const top = coords.top !== undefined ? coords.top : 1.0;
          const bottom = coords.bottom !== undefined ? coords.bottom : -1.0;

          const scaleX = (right - left) / 2.0;
          const scaleY = (top - bottom) / 2.0;
          const translateX = (left + right) / 2.0;
          const translateY = (bottom + top) / 2.0;

          // 創建變換矩陣
          let transformMatrix = [
            scaleX, 0, 0, 0,
            0, scaleY, 0, 0,
            0, 0, 1, 0,
            translateX, translateY, 0, 1
          ];

         // if (index ==1 )
           {
            gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uTransform'), false, transformMatrix);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex.tex);
            gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);
            gl.drawElements(gl.TRIANGLES, indices.value.length, gl.UNSIGNED_SHORT, 0);
          }
        });
      }

      // 渲染基本幾何形狀
      renderBasicGeometry(gl, colorProgram);

      // 渲染骨架
      renderSkeleton(gl, skeletonProgram);

      requestAnimationFrame(() => render2(gl, program, colorProgram, skeletonProgram));
    };

    // 提取的基本幾何渲染函數
    const renderBasicGeometry = (gl, colorProgram) => {
      gl.useProgram(colorProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);

      const colorPosAttrib = gl.getAttribLocation(colorProgram, 'aPosition');
      gl.enableVertexAttribArray(colorPosAttrib);
      gl.vertexAttribPointer(colorPosAttrib, 2, gl.FLOAT, false, 16, 0);

      // 渲染線條
      gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 1, 1, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines.value);
      gl.drawElements(gl.LINES, linesIndices.value.length, gl.UNSIGNED_SHORT, 0);

      // 渲染點
      gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 0, 0, 1);
      gl.uniform1f(gl.getUniformLocation(colorProgram, 'uPointSize'), 5.0);
      gl.drawArrays(gl.POINTS, 0, vertices.value.length / 4);
    };

    // 提取的骨架渲染函數
    const renderSkeleton = (gl, skeletonProgram) => {
      if (skeletonVertices.value.length === 0) return;

      gl.useProgram(skeletonProgram);
      const { skeletonVbo, skeletonEbo, skeletonVerticesArray, skeletonIndicesArray } =
        glsInstance.createSkeletonBuffers(gl);

      const skeletonPosAttrib = gl.getAttribLocation(skeletonProgram, 'aPosition');
      gl.enableVertexAttribArray(skeletonPosAttrib);
      gl.bindBuffer(gl.ARRAY_BUFFER, skeletonVbo);
      gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

      // 渲染所有骨架線條
      gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 0, 1, 0, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skeletonEbo);
      gl.drawElements(gl.LINES, skeletonIndicesArray.length, gl.UNSIGNED_SHORT, 0);

      // 渲染選中的骨架
      renderSelectedBone(gl, skeletonProgram, skeletonIndicesArray);

      // 渲染骨架點
      renderSkeletonPoints(gl, skeletonProgram, skeletonVerticesArray);
    };

    // 渲染選中的骨架
    const renderSelectedBone = (gl, skeletonProgram, skeletonIndicesArray) => {
      if (selectedBone.value.index < 0) return;

      const parentIndex = boneParents.value[selectedBone.value.index];

      // 渲染父骨架（藍色）
      if (parentIndex >= 0) {
        const parentStart = parentIndex * 2;
        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 0, 0, 1, 1);
        gl.drawElements(gl.LINES, 2, gl.UNSIGNED_SHORT, parentStart * 2);
      }

      // 渲染選中骨架（紅色）
      const selectedStart = selectedBone.value.index * 2;
      gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 0, 0, 1);
      gl.drawElements(gl.LINES, 2, gl.UNSIGNED_SHORT, selectedStart * 2);
    };

    // 渲染骨架點
    const renderSkeletonPoints = (gl, skeletonProgram, skeletonVerticesArray) => {
      const skeletonPosAttrib = gl.getAttribLocation(skeletonProgram, 'aPosition');

      // 渲染頭部點
      const headVertices = extractVertices(skeletonVerticesArray, 0, 2); // 提取頭部座標
      renderPoints(gl, skeletonProgram, skeletonPosAttrib, headVertices, [1, 1, 0, 1], 7.0);

      // 渲染尾部點
      const tailVertices = extractVertices(skeletonVerticesArray, 2, 2); // 提取尾部座標
      renderPoints(gl, skeletonProgram, skeletonPosAttrib, tailVertices, [0, 0.5, 1, 1], 7.0);

      // 渲染選中的骨架點
      if (selectedBone.value.index >= 0) {
        renderSelectedBonePoints(gl, skeletonProgram, skeletonPosAttrib, skeletonVerticesArray);
      }
    };

    // 提取頂點座標的輔助函數
    const extractVertices = (verticesArray, startOffset, stride) => {
      const vertices = [];
      for (let i = startOffset; i < verticesArray.length; i += 4) {
        vertices.push(verticesArray[i], verticesArray[i + 1]);
      }
      return vertices;
    };

    // 渲染點的輔助函數
    const renderPoints = (gl, program, posAttrib, vertices, color, pointSize) => {
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);

      gl.uniform4f(gl.getUniformLocation(program, 'uColor'), ...color);
      gl.uniform1f(gl.getUniformLocation(program, 'uPointSize'), pointSize);
      gl.drawArrays(gl.POINTS, 0, vertices.length / 2);

      gl.deleteBuffer(vbo); // 清理臨時緩衝區
    };

    // 渲染選中骨架的點
    const renderSelectedBonePoints = (gl, skeletonProgram, skeletonPosAttrib, skeletonVerticesArray) => {
      const selectedIndex = selectedBone.value.index;

      // 選中的頭部點
      const selectedHeadIndex = selectedIndex * 4;
      const selectedHeadVertices = [
        skeletonVerticesArray[selectedHeadIndex],
        skeletonVerticesArray[selectedHeadIndex + 1]
      ];
      renderPoints(gl, skeletonProgram, skeletonPosAttrib, selectedHeadVertices, [1, 0.5, 0, 1], 10.0);

      // 選中的尾部點
      const selectedTailIndex = selectedIndex * 4 + 2;
      const selectedTailVertices = [
        skeletonVerticesArray[selectedTailIndex],
        skeletonVerticesArray[selectedTailIndex + 1]
      ];
      renderPoints(gl, skeletonProgram, skeletonPosAttrib, selectedTailVertices, [1, 0.5, 0, 1], 10.0);
    };


    // render end

    const drawGlCanvas = async () => {
      const canvas = document.getElementById('webgl');
      const container = canvas.closest('.image-container');
      const webglContext = canvas.getContext('webgl');
      gl.value = webglContext;
      setupCanvasEvents(canvas, webglContext, container);
      program.value = glsInstance.createProgram(webglContext, shaders.vertex, shaders.fragment);
      colorProgram.value = glsInstance.createProgram(webglContext, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = glsInstance.createProgram(webglContext, shaders.skeletonVertex, shaders.skeletonFragment);

      let result = await loadTexture(webglContext, './png3.png');

      texture.value = { tex: result.texture };
      imageData.value = result.data;
      imageWidth.value = result.width;
      imageHeight.value = result.height;
      glsInstance.createBuffers(webglContext);


      render(webglContext, program.value, colorProgram.value, skeletonProgram.value);
      initBone(gl, program, texture.tex, vbo, ebo, indices, glsInstance.resetMeshToOriginal, glsInstance.updateMeshForSkeletonPose);

    };
    const drawAgain = () => {
      drawGlCanvas();
    };
    onMounted(async () => {

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      try {
        drawGlCanvas();
      } catch (error) {
        console.error("Initialization error:", error);
      }
    });

    return {
      selectTool,
      activeTool,
      selectedBone,
      timeline,
      drawAgain
    };
  }
});

const TreeItem = {
  props: ['node', 'expandedNodes', 'selectedBone'],
  template: `
    <div class="tree-item">
      <div class="tree-item-header" :class="{ 'highlighted': checkIsSelected() }">
        <span class="tree-toggle-icon" 
              :class="{ 'expanded': expandedNodes.includes(node.id) }" 
              @click.stop="toggleNode(node.id)" 
              v-if="node.children && node.children.length > 0">▶</span>
        <span class="tree-item-name" @click.stop="handleNameClick(node.name)">{{ node.name }}</span>
      </div>
      <div class="tree-children" v-if="expandedNodes.includes(node.id)">
        <tree-item v-for="child in node.children" 
                  :key="child.id" 
                  :node="child" 
                  :expanded-nodes="expandedNodes" 
                  :selected-bone="selectedBone"
                  @toggle-node="$emit('toggle-node', $event)" 
                  @name-click="$emit('name-click', $event)">
        </tree-item>
      </div>
    </div>
  `,
  methods: {
    toggleNode(nodeId) {
      this.$emit('toggle-node', nodeId);
    },
    handleNameClick(name) {
      const boneIndex = this.node.index;
      this.$emit('name-click', boneIndex);
    },
    checkIsSelected() {
      const boneIndex = this.node.index;
      return boneIndex === this.selectedBone.index;
    }
  }
};

app.component('tree-item', TreeItem);
export default app;