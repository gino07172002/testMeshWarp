const { createApp, onMounted, ref, reactive, computed, watch } = Vue;
const { createPinia } = Pinia;

import { useCounterStore } from './mesh.js'
export const boneIdToIndexMap = reactive({});
export const boneTree = reactive({});
import {
  //initBone,
  boneParents,
  meshSkeleton,
  skeletons,
  lastSelectedBone,
  selectedVertices
} from './useBone.js';

import {
  gl,
  texture,
  program,
  colorProgram,
  skeletonProgram,
  weightPaintProgram,
  skinnedProgram,

} from './useWebGL.js';

import {
  psdHello,
  processPSDFile

} from './psd.js';


import { Bone as MeshBone, Vertex, Mesh2D, Skeleton, getClosestBoneAtClick, Attachment } from './mesh.js';


import {
  Timeline2
} from './timeline2.js';
import glsInstance from './useWebGL.js';
import Bones from './useBone.js';

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
        uniform float uOpacity;
        void main() {
          vec4 color = texture2D(uTexture, vTexCoord);
          gl_FragColor = vec4(color.rgb, color.a * uOpacity);
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
      `,
  weightPaintVertex: `
    attribute vec2 aPosition;
    uniform mat4 uTransform;
    void main() {
      gl_Position = uTransform * vec4(aPosition, 0.0, 1.0);
    }
  `,
  weightPaintFragment: `
    precision mediump float;
    uniform vec4 uColor;
    void main() {
      gl_FragColor = uColor;
    }
  `,
  skinnedVertex: `
 attribute vec2 aPosition;
  attribute vec2 aTexCoord;

  // Bone Skinning
  attribute vec4 aBoneIndices;   // 每個頂點最多 4 骨骼
  attribute vec4 aBoneWeights;

  uniform mat4 uTransform;
  uniform sampler2D uBoneTexture; // 骨骼矩陣 texture
  uniform float uBoneTextureSize; // 骨骼數量 / texture 寬度 (每骨骼 4 row)

  varying vec2 vTexCoord;

  // 從骨骼 texture 讀 4x4 矩陣
  mat4 getBoneMatrix(float index) {
      float y = (index * 4.0 + 0.5) / uBoneTextureSize;
      mat4 m;
      m[0] = texture2D(uBoneTexture, vec2(0.5 / 4.0, y));
      m[1] = texture2D(uBoneTexture, vec2(1.5 / 4.0, y));
      m[2] = texture2D(uBoneTexture, vec2(2.5 / 4.0, y));
      m[3] = texture2D(uBoneTexture, vec2(3.5 / 4.0, y));
      return m;
  }

  void main() {
      vec4 pos = vec4(aPosition, 0.0, 1.0);
      vec4 skinned = vec4(0.0);

      for(int i = 0; i < 4; i++) {
          float bIndex = aBoneIndices[i];
          float w = aBoneWeights[i];
          mat4 boneMat = getBoneMatrix(bIndex);
          skinned += boneMat * pos * w;
      }

      gl_Position = uTransform * skinned;
      vTexCoord = vec2(aTexCoord.x, 1.0 - aTexCoord.y);
  }
  `,
  skinnedFragment: `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D uTexture;
  uniform float uOpacity;

  void main() {
      vec4 color = texture2D(uTexture, vTexCoord);
      gl_FragColor = vec4(color.rgb, color.a * uOpacity);
  }
    `
};
// 準備多圖層資料結構陣列
let layersForTexture = [];
let wholeImageWidth = 0;
let wholeImageHeight = 0;
// Coordinate conversion utility function
const convertToNDC = (e, canvas, container) => {
  const rect = canvas.getBoundingClientRect();

  // 考慮 devicePixelRatio
  const dpr = window.devicePixelRatio || 1;

  // 取得在 canvas 內的相對位置 (CSS 像素)
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 換算成 canvas 實際像素
  const canvasX = x * (canvas.width / rect.width);
  const canvasY = y * (canvas.height / rect.height);

  return {
    x: (canvasX / canvas.width) * 2 - 1, // NDC X
    y: 1 - (canvasY / canvas.height) * 2 // NDC Y
  };
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
    // 解析 Promise，返回紋理 all coordinate needed
    console.log(" top : ", layer.top, " , left: ", layer.left);
    resolve({ tex: texture, coords: coords, width: layer.width, height: layer.height, top: layer.top, left: layer.left, image: imageData });
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
      refreshKey: 0,
      timelineLength: 1000,
      dragInfo: { dragging: false, startX: 0, type: null },
      timeSelection: { active: false, start: 0, end: 0 },
      animationPlaying: false,
      animationStartTime: 0,
      nextKeyframeId: 10,
      psdLayers: [],
      fileDropdown: false,
      editDropdown: false,


    };
  },
  async mounted() {

    console.log("somehow mount here ... ");
    document.addEventListener('click', this.closeAllDropdowns);
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
    forceUpdate() {
      this.refreshKey++;
    },
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

      //console.log("Processing layer:", layer.name, "ImageData type:", Object.prototype.toString.call(layer.imageData));

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
          layersForTexture = [];
          const psdInfo = await processPSDFile(file);
          this.psdLayers = psdInfo.layers;

          let imageWidth = psdInfo.width;
          let imageHeight = psdInfo.height;
          wholeImageHeight = imageHeight;
          wholeImageWidth = imageWidth;
          const glContext = gl.value; // WebGL context from useWebGL.js



          for (const layer of this.psdLayers) {
            // Create texture for the layer
            layer.texture = this.createLayerTexture(glContext, layer);

            // Calculate NDC coordinates based on layer position and size
            const left = layer.left || 0;
            const top = layer.top || 0;
            const right = left + (layer.width || imageWidth);
            const bottom = top + (layer.height || imageHeight);

            const ndcLeft = (left / imageWidth) * 2 - 1;
            const ndcRight = (right / imageWidth) * 2 - 1;
            const ndcTop = 1 - (top / imageHeight) * 2;
            const ndcBottom = 1 - (bottom / imageHeight) * 2;

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

            // 將圖層轉換成與 PNG 相同的資料結構格式
            const layerForTexture = {
              imageData: layer.imageData, // 假設 PSD 圖層已經有 imageData (Uint8Array 格式)
              width: layer.width,
              height: layer.height,
              // 如果需要額外的圖層資訊，可以加上：
              left: layer.left || -1,
              top: layer.top || 1,
              name: layer.name || `Layer ${layersForTexture.length}`,
              opacity: layer.opacity || 1.0,
              blendMode: layer.blendMode || 'normal'
            };
            console.log("let see new psd layer: ", layer.top, " , ", layer.left);


            layersForTexture.push(layerForTexture);
          }


          console.log(" then renew canvas... ");



        }
      } catch (error) {
        console.error("處理 PSD 檔案時出錯:", error);
      }
    },
    saveProjectToServer() {
      this.status = '正在儲存專案...';
      const projectData = {
        layers: this.layers,
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
    showBone() {
      console.log("hi show bone");
      console.log("hi bone ", JSON.stringify(this.boneTree));
    },
    toggleDropdown(menu) {
      if (menu == 'fileDropdown') {
        this.fileDropdown = true;
        this.editDropdown = false;
      }
      else {
        this.fileDropdown = false;
        this.editDropdown = true;
      }

    },
    handleFileAction(action) {
      console.log(" hi action ", action);
      this.closeAllDropdowns();
    },
    handleEditAction(action) {
      console.log(" hi action ", action);
      this.closeAllDropdowns();
    },
    closeAllDropdowns() {
      console.log(" close menu ... ");
      this.fileDropdown = false;
      this.editDropdown = false;

    },

    // 在组件挂载时添加全局点击监听




  },
  setup() {
    const selectedVertex = ref(-1);
    const activeTool = ref('grab-point');
    const skeletonIndices = ref([]);
    const isShiftPressed = ref(false);
    const isCtrlPressed = ref(false);
    const instance = Vue.getCurrentInstance();
    const mousePressed = ref(); // e event of mouse down , ex: 0:left, 2:right
    const refreshKey = ref(0);
    const expandedNodes = reactive([]);
    const showLayers = ref(glsInstance.layers);
    const selectedLayers = ref([]);
    const chosenLayers = ref([])   // 控制選擇(多選)
    const currentChosedLayer = ref(0); // 控制選擇(單選) 
    const selectedValues = ref([]);
    const selectedGroups = ref([]); // 控制選擇的頂點群組
    let currentJobName = null;
    const isWeightPaintMode = ref(true);

    const timelineList = ref([new Timeline2('main', 2.0)])
    const selectedTimelineId = ref(0)
    const timeline2 = computed(() => timelineList.value[selectedTimelineId.value])

    //pinia test
    const counter = useCounterStore();

    const forceUpdate = () => {
      refreshKey.value++; // 每次加 1 → 會觸發 template 重新渲染
    };
    function syncLayers() {
      forceUpdate();
      showLayers.value = glsInstance.layers;
    }



    function toggleNode(nodeId) {
      // nodeId 可能是 string 或物件（防呆）
      const id = typeof nodeId === 'object' ? nodeId.id : nodeId;
      const idx = expandedNodes.indexOf(id);
      if (idx >= 0) expandedNodes.splice(idx, 1);
      else expandedNodes.push(id);
    }


    function handleNameClick(input) {
      // selectedBone.value = boneId; // 或做你原本選骨骼的處理

      let boneId = input.id || input; // 防呆處理
      console.log(" click bone id : ", boneId, "bone index? ", boneId.boneIndex);

      lastSelectedBone.value = bonesInstance.findBoneById(boneId);

      console.log(" lastSelectedBone : ", lastSelectedBone.value.id);
    };
    const bonesInstance = new Bones({
      onUpdate: () => instance.proxy.$forceUpdate(),
      vueInstance: instance,
      gl: gl.value,
      isShiftPressed: isShiftPressed,
      skeletonIndices: skeletonIndices,
      glsInstance: glsInstance,
    });

    const selectTool = (tool) => {
      activeTool.value = tool;
      console.log("switch to tool : ", tool);
      if (activeTool.value === 'bone-animate') {
        // bonesInstance.restoreSkeletonVerticesFromLast();
      }
      else if (tool === 'bone-create') {
        // glsInstance.resetMeshToOriginal();
        // bonesInstance.resetSkeletonToOriginal();
      }
      else if (tool === 'bone-clear') {
        bonesInstance.clearBones();
      } else if (tool === 'bone-save') {
        bonesInstance.saveBones();
        // bonesInstance.checkKeyframe();
      } else if (tool === 'bone-load') {
        bonesInstance.loadBones();
      }

    };

    const resetPose = () => {
      //bonesInstance.resetPoseToOriginal()
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Shift') {
        isShiftPressed.value = true;
      }
      if (e.key === 'Control') {
        isCtrlPressed.value = true;
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Shift') {
        isShiftPressed.value = false;
      }
      if (e.key === 'Control') {
        isCtrlPressed.value = false;
      }
    };

    const setupCanvasEvents = (canvas, gl, container) => {
      let isDragging = false;
      let alreadySelect = false;
      let localSelectedVertex = -1;
      let startPosX = 0;
      let startPosY = 0;
      let useMultiSelect = true;
      let dragStartX = 0, dragStartY = 0; // 記錄滑鼠起始點


      const handleMouseDown = (e) => {
        mousePressed.value = e.button;
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);
        startPosX = xNDC;
        startPosY = yNDC;

        if (e.button === 0 || e.button === 2) {
          if (activeTool.value === 'grab-point') {

            if (!useMultiSelect) {
              // ===== 單點選取模式 =====
              let minDist = Infinity;
              localSelectedVertex = -1;

              const vertices = glsInstance.layers[currentChosedLayer.value].vertices.value;
              for (let i = 0; i < vertices.length; i += 4) {
                const dx = vertices[i] - xNDC;
                const dy = vertices[i + 1] - yNDC;
                const dist = dx * dx + dy * dy;
                if (dist < minDist) {
                  minDist = dist;
                  localSelectedVertex = i / 4;
                }
              }

              if (minDist < 0.02) {
                isDragging = true;
                selectedVertex.value = localSelectedVertex; // 單點記錄
              }

            } else {
              // ===== 多點群組模式 =====
              // 檢查點擊是否落在 selectedVertices 裡的某一個頂點
              let hitVertex = -1;
              const vertices = glsInstance.layers[currentChosedLayer.value].vertices.value;

              for (let idx of selectedVertices.value) {
                const vx = vertices[idx * 4];
                const vy = vertices[idx * 4 + 1];
                const dx = vx - xNDC;
                const dy = vy - yNDC;
                const dist = dx * dx + dy * dy;
                if (dist < 0.02) {
                  hitVertex = idx;
                  break;
                }
              }
              console.log(" hitVertex : ", hitVertex);

              if (hitVertex !== -1) {
                isDragging = true;
                dragStartX = xNDC;
                dragStartY = yNDC;
              }
            }


          } else if (activeTool.value === 'select-points') {
            bonesInstance.handleSelectPointsMouseDown(xNDC, yNDC, e.button === 0, isShiftPressed.value);
            isDragging = true;

          }

          else if (activeTool.value === 'bone-create') {
            if (e.button === 2) {
              console.log(" right button down edit bone...  ");
              bonesInstance.handleMeshBoneEditMouseDown(xNDC, yNDC);
              isDragging = true;
            }
            else {
              //  if(!getBone)
              bonesInstance.handleMeshBoneCreateMouseDown(xNDC, yNDC, isShiftPressed.value);
              //bonesInstance.handleBoneCreateMouseDown(xNDC, yNDC, isShiftPressed.value);
              isDragging = true;
            }
          } else if (activeTool.value === 'bone-animate') {
            bonesInstance.GetCloestBoneAsSelectBone(xNDC, yNDC, false);

            isDragging = true;
          }
        }
      };

      const handleMouseMove = (e) => {
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);

        if (!isDragging) {
          const isCreatMode = (activeTool.value === 'bone-create');
          bonesInstance.GetCloestBoneAsHoverBone(xNDC, yNDC, isCreatMode);

          return;
        }

        if (activeTool.value === 'grab-point' && isDragging) {

          bonesInstance.moveSelectedVertex(currentChosedLayer, useMultiSelect, localSelectedVertex, gl, xNDC, yNDC, dragStartX, dragStartY);
          dragStartX = xNDC;
          dragStartY = yNDC;

          forceUpdate();

        } else if (activeTool.value === 'select-points') {
          if (isDragging)
            bonesInstance.handleSelectPointsMouseMove(xNDC, yNDC, isShiftPressed.value);

        }

        else if (activeTool.value === 'bone-create') {

          // console.log(" mouse move event : ", e.buttons);  // in mouse move e.buttons: 1:left, 2:right, 3:left+right
          if (e.buttons === 2) {  //edit selected bone
            //   console.log(" right button move edit bone...  ");
            bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
          }
          else {
            //console.log(" left button move create bone...  ");
            bonesInstance.meshboneCreateMouseMove(xNDC, yNDC);
          }

        } else if (activeTool.value === 'bone-animate') {
          bonesInstance.handleMeshBoneAnimateMouseDown(xNDC, yNDC);
          bonesInstance.updatePoseMesh(gl);
          forceUpdate();
          // console.log(" xNDC: ",xNDC," , yNDC",yNDC);
          //   startPosX = xNDC;
          //    startPosY = yNDC;
        }
      };

      const handleMouseUp = (e) => {
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);

        if (activeTool.value === 'bone-create' && isDragging) {

          if (e.button === 2) { //edit selected bone
            bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
          }
          else {
            bonesInstance.MeshBoneCreate(xNDC, yNDC);
          }


          //bonesInstance.assignVerticesToBones();
        }
        else if (activeTool.value === 'select-points') {
          if (isDragging) {
            bonesInstance.handleSelectPointsMouseUp(xNDC, yNDC, currentChosedLayer.value, isShiftPressed.value, isCtrlPressed.value);
            isDragging = false;
          }
        }


        else if (activeTool.value === 'bone-animate' && isDragging) {
          // bonesInstance.handleBoneAnimateMouseUp();
        }
        isDragging = false;
        selectedVertex.value = -1;
        mousePressed.value = null;

        forceUpdate();
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



    var time = 0;

    // 修复后的渲染函数 - 解决只能看到最后一个图层的问题
    const render2 = (gl, program, colorProgram, skeletonProgram, renderLayer, jobName) => {
      if (currentJobName != jobName)
        return;

      // 啟用混合，但不要用深度測試（透明圖層會出問題）
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // 不要清掉畫布，不然會只剩最後一層
      // gl.clear(gl.COLOR_BUFFER_BIT);

      time += 0.016;

      if (!texture.value || !Array.isArray(texture.value) || texture.value.length === 0) {
        console.log(" nothing here, stop loop");
        return;
      }

      const textures = texture.value;

      gl.useProgram(program);


      // let layerIndices = [0, 1, 2, 3, 4];
      let layerIndices = selectedLayers.value;
      layerIndices.sort((a, b) => a - b); // 數字由小到大排序

      if (layerIndices.length == 0)
        layerIndices = [0];

      for (const layerIndex of layerIndices) {
        if (layerIndex >= textures.length)
          continue;
        const tex = textures[layerIndex];
        const layer = renderLayer[layerIndex];

        if (!tex || !tex.tex || !layer || !layer.vbo || !layer.ebo) {
          console.warn(`Skipping layer ${layerIndex}: missing resources`);
          continue;
        }

        if (layer.visible === false) {
          console.log(`Layer ${layerIndex} is hidden`);
          continue;
        }

        // === 綁定當前圖層的緩衝區 ===
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ebo);

        // === 設定頂點屬性 ===
        const positionAttrib = gl.getAttribLocation(program, 'aPosition');
        const texCoordAttrib = gl.getAttribLocation(program, 'aTexCoord');

        if (positionAttrib !== -1) {
          gl.enableVertexAttribArray(positionAttrib);
          gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 16, 0);
        }

        if (texCoordAttrib !== -1) {
          gl.enableVertexAttribArray(texCoordAttrib);
          gl.vertexAttribPointer(texCoordAttrib, 2, gl.FLOAT, false, 16, 8);
        }

        // === 計算轉換矩陣 ===
        const { left, top, width, height, canvasWidth, canvasHeight } = layer.transformParams;
        //console.log("what's my top left : ", top, " , ", left);
        // const glLeft = (left / canvasWidth) * 2 - 1;
        const glLeft = left;  // -1
        const glRight = left + (width / canvasWidth) * 2; //1
        const glTop = top;   // 1
        const glBottom = top - (height / canvasHeight) * 2; //-1
        // console.log(" what's my top :",top," left: ",left);

        //  console.log(" checking width : ",width," canvas widith : ",canvasWidth);
        const sx = (glRight - glLeft) / 2;
        const sy = (glTop - glBottom) / 2;
        const tx = glLeft + sx;
        const ty = glBottom + sy;


        const transformMatrix = new Float32Array([
          sx, 0, 0, 0,
          0, sy, 0, 0,
          0, 0, 1, 0,
          tx, ty, 0, 1
        ]);

        const transformLocation = gl.getUniformLocation(program, 'uTransform');
        if (transformLocation) {
          gl.uniformMatrix4fv(transformLocation, false, transformMatrix);
        }

        // === 設定透明度 ===
        const opacity = layer.opacity?.value ?? 1.0;
        const opacityLocation = gl.getUniformLocation(program, 'uOpacity');
        if (opacityLocation !== null) {
          gl.uniform1f(opacityLocation, opacity);
        }

        // === 綁定紋理 ===
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex.tex);
        gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);

        // === 繪製圖層 ===
        gl.drawElements(gl.TRIANGLES, layer.indices.length, gl.UNSIGNED_SHORT, 0);
        // gl.drawElements(gl.TRIANGLES, layer.indices.length, gl.UNSIGNED_SHORT, 0);
      }

      // === 在所有圖層之後渲染格線/骨架 ===
      if (isWeightPaintMode && selectedGroups.value.length > 0) {
        // Weight Paint Mode
        renderGridOnly(gl, colorProgram, selectedVertices.value); // 先畫網格和小點
        renderWeightPaint(gl, weightPaintProgram.value, selectedGroups.value[0]); // 再疊加權重視覺化
      } else {
        // 正常模式
        // const selectedVertices = getSelectedVertexIndices(); // 你的選取邏輯
        renderGridOnly(gl, colorProgram, selectedVertices.value);
      }

      // === 渲染骨架 ===
      if (typeof renderMeshSkeleton === 'function' && meshSkeleton) {
        renderMeshSkeleton(gl, skeletonProgram, meshSkeleton);
      }
      // 下一幀
      requestAnimationFrame(() =>
        render2(gl, program, colorProgram, skeletonProgram, renderLayer, jobName)
      );
    };

    function renderWeightPaint(gl, program, selectedGroupName) {
      if (!program || glsInstance.getLayerSize() === 0) return;

      const layerIndex = currentChosedLayer.value;
      const layer = glsInstance.layers[layerIndex];

      if (!layer || !layer.vertexGroup || !layer.vertices.value) return;

      // 找到選中的 vertex group
      const group = layer.vertexGroup.value.find(g => g.name === selectedGroupName);
      if (!group || !group.vertices || group.vertices.length === 0) return;

      // 準備繪製三角形來顯示權重
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ebo);

      const positionAttrib = gl.getAttribLocation(program, 'aPosition');
      if (positionAttrib !== -1) {
        gl.enableVertexAttribArray(positionAttrib);
        gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 16, 0);
      }

      // 設定變換矩陣(與主渲染使用相同的變換)
      const { left, top, width, height, canvasWidth, canvasHeight } = layer.transformParams;
      const glLeft = left;
      const glRight = left + (width / canvasWidth) * 2;
      const glTop = top;
      const glBottom = top - (height / canvasHeight) * 2;

      const sx = (glRight - glLeft) / 2;
      const sy = (glTop - glBottom) / 2;
      const tx = glLeft + sx;
      const ty = glBottom + sy;

      const transformMatrix = new Float32Array([
        sx, 0, 0, 0,
        0, sy, 0, 0,
        0, 0, 1, 0,
        tx, ty, 0, 1
      ]);

      const transformLocation = gl.getUniformLocation(program, 'uTransform');
      if (transformLocation) {
        gl.uniformMatrix4fv(transformLocation, false, transformMatrix);
      }

      // 為每個三角形設定顏色並繪製
      const colorLocation = gl.getUniformLocation(program, 'uColor');

      // 建立 vertex id 到 weight 的映射
      const weightMap = new Map();
      group.vertices.forEach(v => {
        weightMap.set(v.id, v.weight);
      });

      // 遍歷所有三角形
      const indices = layer.indices;
      for (let i = 0; i < indices.length; i += 3) {
        const idx0 = indices[i];
        const idx1 = indices[i + 1];
        const idx2 = indices[i + 2];

        // 檢查三個頂點是否在 vertex group 中
        const hasIdx0 = weightMap.has(idx0);
        const hasIdx1 = weightMap.has(idx1);
        const hasIdx2 = weightMap.has(idx2);

        // 如果三個頂點都不在 group 中,跳過這個三角形
        // if (!hasIdx0 || !hasIdx1 || !hasIdx2) {
        if (!hasIdx0 && !hasIdx1 && !hasIdx2) {
          continue;
        }

        // 獲取三個頂點的權重(不在 group 中的視為 0)
        const w0 = hasIdx0 ? weightMap.get(idx0) : 0;
        const w1 = hasIdx1 ? weightMap.get(idx1) : 0;
        const w2 = hasIdx2 ? weightMap.get(idx2) : 0;

        // 計算平均權重(只計算在 group 中的頂點)
        const count = (hasIdx0 ? 1 : 0) + (hasIdx1 ? 1 : 0) + (hasIdx2 ? 1 : 0);
        const avgWeight = (w0 + w1 + w2) / count;

        // 權重轉顏色 (Blender 風格: 藍->綠->黃->紅)
        const color = weightToColor(avgWeight);

        // 設定半透明顏色
        gl.uniform4f(colorLocation, color.r, color.g, color.b, 0.5);

        // 繪製這個三角形
        gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, i * 2);
      }
    }
    function weightToColor(weight) {
      // weight: 0.0 (藍) -> 0.5 (綠/黃) -> 1.0 (紅)
      let r, g, b;

      if (weight < 0.25) {
        // 藍 -> 青
        const t = weight / 0.25;
        r = 0;
        g = t;
        b = 1;
      } else if (weight < 0.5) {
        // 青 -> 綠
        const t = (weight - 0.25) / 0.25;
        r = 0;
        g = 1;
        b = 1 - t;
      } else if (weight < 0.75) {
        // 綠 -> 黃
        const t = (weight - 0.5) / 0.25;
        r = t;
        g = 1;
        b = 0;
      } else {
        // 黃 -> 紅
        const t = (weight - 0.75) / 0.25;
        r = 1;
        g = 1 - t;
        b = 0;
      }

      return { r, g, b };
    }


    // 辅助函数：只渲染网格
    function renderGridOnly(gl, colorProgram, selectedVertices = []) {
      if (glsInstance.getLayerSize() === 0) return;
      //console.log(" draw selectde vertices : ",selectedVertices);

      let layerIndex = currentChosedLayer.value;
      if (layerIndex >= glsInstance.getLayerSize())
        layerIndex = 0;

      const baseLayer = glsInstance.layers[layerIndex];
      if (!baseLayer || !baseLayer.vbo) return;

      // === 渲染网格线 ===
      gl.useProgram(colorProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, baseLayer.vbo);

      const colorPosAttrib = gl.getAttribLocation(colorProgram, 'aPosition');
      if (colorPosAttrib !== -1) {
        gl.enableVertexAttribArray(colorPosAttrib);
        gl.vertexAttribPointer(colorPosAttrib, 2, gl.FLOAT, false, 16, 0);
      }

      // 渲染网格线
      if (baseLayer.eboLines && baseLayer.linesIndices && baseLayer.linesIndices.length > 0) {
        gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 1, 1, 0.3);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, baseLayer.eboLines);
        gl.drawElements(gl.LINES, baseLayer.linesIndices.length, gl.UNSIGNED_SHORT, 0);
      }

      // 渲染顶点
      if (baseLayer.vertices.value && baseLayer.vertices.value.length > 0) {
        const pointSizeLocation = gl.getUniformLocation(colorProgram, 'uPointSize');
        if (pointSizeLocation !== null) {
          // 所有點先畫小紅點
          gl.uniform1f(pointSizeLocation, 3.0);
        }
        gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 0, 0, 1);
        gl.drawArrays(gl.POINTS, 0, baseLayer.vertices.value.length / 4);

        // 再畫選取的點 (大綠點)
        if (selectedVertices && selectedVertices.length > 0) {
          if (pointSizeLocation !== null) {
            gl.uniform1f(pointSizeLocation, 6.0);
          }
          gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 0, 1, 0, 1);
          for (let idx of selectedVertices) {
            gl.drawArrays(gl.POINTS, idx, 1);
          }
        }
      }
    }

    // 调试函数：打印图层信息
    function debugLayers() {
      console.log("=== Layer Debug Info ===");
      console.log("Total layers:", glsInstance.getLayerSize());
      console.log("Texture count:", texture.value?.length || 0);

      for (let i = 0; i < glsInstance.getLayerSize(); i++) {
        const layer = glsInstance.layers[i];
        const tex = texture.value?.[i];

        console.log(`Layer ${i}:`, {
          name: layer?.name?.value || 'unnamed',
          hasVbo: !!layer?.vbo,
          hasEbo: !!layer?.ebo,
          hasTexture: !!tex?.tex,
          visible: layer?.visible !== false,
          opacity: layer?.opacity?.value ?? 1.0,
          vertexCount: layer?.vertices?.value?.length / 4 || 0
        });
      }
    }

    // 图层控制函数
    function setLayerVisibility(layerIndex, visible) {
      if (layerIndex >= 0 && layerIndex < glsInstance.getLayerSize()) {
        const layer = glsInstance.layers[layerIndex];
        if (layer) {
          layer.visible = visible;
          console.log(`Layer ${layerIndex} visibility set to:`, visible);
        }
      }
    }

    function setLayerOpacity(layerIndex, opacity) {
      if (layerIndex >= 0 && layerIndex < glsInstance.getLayerSize()) {
        const layer = glsInstance.layers[layerIndex];
        if (layer) {
          if (!layer.opacity) layer.opacity = { value: 1.0 };
          layer.opacity.value = Math.max(0, Math.min(1, opacity));
          console.log(`Layer ${layerIndex} opacity set to:`, layer.opacity.value);
        }
      }
    }

    // 初始化时的处理
    function initializeLayerVisibility() {
      // 确保所有图层默认可见
      for (let i = 0; i < glsInstance.getLayerSize(); i++) {
        const layer = glsInstance.layers[i];
        if (layer) {
          if (layer.visible === undefined) {
            layer.visible = true;
          }
          if (!layer.opacity) {
            layer.opacity = { value: 1.0 };
          }
        }
      }
    }

    // 测试函数：逐个显示图层
    function testLayerVisibility() {
      console.log("Testing layer visibility...");

      // 先隐藏所有图层
      for (let i = 0; i < glsInstance.getLayerSize(); i++) {
        setLayerVisibility(i, false);
      }

      // 每2秒显示下一个图层
      let currentLayer = 0;
      const showNextLayer = () => {
        if (currentLayer < glsInstance.getLayerSize()) {
          setLayerVisibility(currentLayer, true);
          console.log(`Showing layer ${currentLayer}`);
          currentLayer++;
          setTimeout(showNextLayer, 2000);
        } else {
          // 显示所有图层
          for (let i = 0; i < glsInstance.getLayerSize(); i++) {
            setLayerVisibility(i, true);
          }
          console.log("All layers visible");
        }
      };

      showNextLayer();
    }



    const renderMeshSkeleton = (gl, skeletonProgram, meshSkeleton) => {
      // 保存當前WebGL狀態
      const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const prevElementBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
      const prevBlend = gl.getParameter(gl.BLEND);

      gl.useProgram(skeletonProgram);
      const skeletonPosAttrib = gl.getAttribLocation(skeletonProgram, 'aPosition');

      // === 渲染現有骨架 ===
      if (meshSkeleton && meshSkeleton.bones.length > 0) {
        const vertices = [];
        const indices = [];
        const headVertices = [];
        const tailVertices = [];
        let vertexIndex = 0;

        const processRootBones = () => {
          // 獲取所有根骨骼
          const rootBones = meshSkeleton.bones.filter(bone => !bone.parent);

          // 從每個根骨骼開始遞迴處理
          const processBoneRecursive = (bone) => {
            let transform;
            if (activeTool.value === "bone-animate") {
              // 在動畫模式下使用 pose transform
              bone.updatePoseGlobalTransform(); // update pose transform from local and parent
              transform = bone.getGlobalPoseTransform();
            } else {
              // 其他模式下使用一般的 global transform
              transform = bone.getGlobalTransform();
            }

            vertices.push(transform.head.x, transform.head.y);
            vertices.push(transform.tail.x, transform.tail.y);

            headVertices.push(transform.head.x, transform.head.y);
            tailVertices.push(transform.tail.x, transform.tail.y);

            indices.push(vertexIndex, vertexIndex + 1);
            vertexIndex += 2;

            // 遞迴處理所有子骨骼
            bone.children.forEach(child => processBoneRecursive(child));
          };

          // 處理每個根骨骼
          rootBones.forEach(rootBone => processBoneRecursive(rootBone));
        };

        processRootBones();

        const skeletonVbo = gl.createBuffer();
        const skeletonEbo = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, skeletonVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skeletonEbo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(skeletonPosAttrib);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

        // 渲染骨架線條（白色）
        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 1, 1, 1);
        gl.drawElements(gl.LINES, indices.length, gl.UNSIGNED_SHORT, 0);

        // 渲染頭部和尾部點
        renderPoints(gl, skeletonProgram, skeletonPosAttrib, new Float32Array(headVertices), [1, 1, 0, 1], 7.0); // 黃色頭部
        renderPoints(gl, skeletonProgram, skeletonPosAttrib, new Float32Array(tailVertices), [0, 0.5, 1, 1], 7.0); // 藍色尾部

        gl.deleteBuffer(skeletonVbo);
        gl.deleteBuffer(skeletonEbo);
      }

      // === 渲染滑鼠拖曳中的暫時骨架 ===
      if (bonesInstance && mousePressed.value === 0) {
        const dragBoneData = bonesInstance.GetMouseDragBone?.() || {};
        const { mousedown_x, mousedown_y, mousemove_x, mousemove_y } = dragBoneData;

        const hasValidDragData = mousedown_x != null && mousedown_y != null &&
          mousemove_x != null && mousemove_y != null;

        if (hasValidDragData) {
          const tempVertices = new Float32Array([mousedown_x, mousedown_y, mousemove_x, mousemove_y]);
          const tempIndices = new Uint16Array([0, 1]);

          const tempVbo = gl.createBuffer();
          const tempEbo = gl.createBuffer();

          gl.bindBuffer(gl.ARRAY_BUFFER, tempVbo);
          gl.bufferData(gl.ARRAY_BUFFER, tempVertices, gl.STATIC_DRAW);

          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tempEbo);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tempIndices, gl.STATIC_DRAW);

          gl.enableVertexAttribArray(skeletonPosAttrib);
          gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

          // 暫時骨架（紅色）
          gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 0, 0, 1);
          gl.drawElements(gl.LINES, 2, gl.UNSIGNED_SHORT, 0);

          renderPoints(gl, skeletonProgram, skeletonPosAttrib, new Float32Array([mousedown_x, mousedown_y]), [1, 0.5, 0, 1], 8.0);
          renderPoints(gl, skeletonProgram, skeletonPosAttrib, new Float32Array([mousemove_x, mousemove_y]), [1, 0, 0.5, 1], 8.0);

          gl.deleteBuffer(tempVbo);
          gl.deleteBuffer(tempEbo);
        }
      }

      // === 渲染 lastSelectedBone ===
      //get last selected bone from bonesInstance by GetLastSelectedBone() function
      const lastSelectedBone = bonesInstance.GetLastSelectedBone?.();
      if (lastSelectedBone) {
        const bone = lastSelectedBone;

        // 區分create mode 跟 pose mode的不同座標
        const transform = (activeTool.value === "bone-animate") ? bone.getGlobalPoseTransform() : bone.getGlobalTransform();

        const vertices = new Float32Array([transform.head.x, transform.head.y, transform.tail.x, transform.tail.y]);
        const indices = new Uint16Array([0, 1]);

        const vbo = gl.createBuffer();
        const ebo = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        gl.enableVertexAttribArray(skeletonPosAttrib);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

        // 綠色選中骨架
        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 0, 1, 0, 1);
        gl.drawElements(gl.LINES, 2, gl.UNSIGNED_SHORT, 0);

        // 頭尾點
        renderPoints(gl, skeletonProgram, skeletonPosAttrib, new Float32Array([transform.head.x, transform.head.y]), [0, 1, 0, 1], 9.0);
        renderPoints(gl, skeletonProgram, skeletonPosAttrib, new Float32Array([transform.tail.x, transform.tail.y]), [0, 1, 0, 1], 9.0);

        gl.deleteBuffer(vbo);
        gl.deleteBuffer(ebo);
      }

      // === 渲染 mouseHoveringBone ===
      //get last mouseHoveringBone from bonesInstance by GetHoverBone() function
      const mouseHoveringBone = bonesInstance.GetHoverBone?.();
      if (mouseHoveringBone && (mouseHoveringBone !== lastSelectedBone)) {
        const bone = mouseHoveringBone;
        const transform = (activeTool.value === "bone-animate") ? bone.getGlobalPoseTransform() : bone.getGlobalTransform();

        const vertices = new Float32Array([transform.head.x, transform.head.y, transform.tail.x, transform.tail.y]);
        const indices = new Uint16Array([0, 1]);

        const vbo = gl.createBuffer();
        const ebo = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        gl.enableVertexAttribArray(skeletonPosAttrib);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

        // 青色 Hover 骨架
        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 0, 1, 1, 1);
        gl.drawElements(gl.LINES, 2, gl.UNSIGNED_SHORT, 0);

        // 頭尾點
        renderPoints(gl, skeletonProgram, skeletonPosAttrib, new Float32Array([transform.head.x, transform.head.y]), [0, 1, 1, 1], 8.0);
        renderPoints(gl, skeletonProgram, skeletonPosAttrib, new Float32Array([transform.tail.x, transform.tail.y]), [0, 1, 1, 1], 8.0);

        gl.deleteBuffer(vbo);
        gl.deleteBuffer(ebo);
      }

      // === 恢復WebGL狀態 ===
      gl.useProgram(prevProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prevElementBuffer);

      if (prevBlend) {
        gl.enable(gl.BLEND);
      } else {
        gl.disable(gl.BLEND);
      }
    };


    // 渲染點的輔助函數
    const renderPoints = (gl, program, posAttrib, verticesPoints, color, pointSize) => {
      const vbo_temp = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo_temp);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verticesPoints), gl.STATIC_DRAW);
      gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);

      gl.uniform4f(gl.getUniformLocation(program, 'uColor'), ...color);
      gl.uniform1f(gl.getUniformLocation(program, 'uPointSize'), pointSize);
      gl.drawArrays(gl.POINTS, 0, verticesPoints.length / 2);

      gl.deleteBuffer(vbo_temp); // 清理臨時緩衝區
    };



    // render end

    const drawGlCanvas = async () => {
      const canvas = document.getElementById('webgl');
      const container = canvas.closest('.image-container');
      const webglContext = canvas.getContext('webgl');

      gl.value = webglContext;
      setupCanvasEvents(canvas, gl.value, container);

      // 创建着色器程序
      program.value = glsInstance.createProgram(gl.value, shaders.vertex, shaders.fragment);
      colorProgram.value = glsInstance.createProgram(gl.value, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = glsInstance.createProgram(gl.value, shaders.skeletonVertex, shaders.skeletonFragment);
      weightPaintProgram.value = glsInstance.createProgram(gl.value, shaders.weightPaintVertex, shaders.weightPaintFragment);
      skinnedProgram.value = glsInstance.createProgram(gl.value, shaders.skinnedVertex, shaders.skinnedFragment);
      firstImage();
    };

    const firstImage = async () => {
      if (!gl.value) return;

      console.log("load first image...");

      // 清空之前的圖層
      glsInstance.clearAllLayer();
      texture.value = [];
      selectedLayers.value = [];

      // 加载纹理
      let result = await loadTexture(gl.value, './png3.png');

      let layer = {
        imageData: result.data,
        width: result.width,
        height: result.height,
        top: 0,   // 預設居中顯示
        left: 0
      };

      texture.value.push(await layerToTexture(gl.value, layer));
      glsInstance.addLayer("QQ");

      let canvasHeight = layer.height;
      let canvasWidth = layer.width;

      // === 初始化图层缓冲区和顶点属性 ===
      for (let i = 0; i < texture.value.length; i++) {
        glsInstance.createLayerBuffers(
          gl.value,
          texture.value[i].image,
          texture.value[i].width,
          texture.value[i].height,
          1,
          -1,
          canvasWidth,
          canvasHeight,
          glsInstance.layers[i]
        );

        // 绑定当前图层的缓冲区
        const layerObj = glsInstance.layers[i];
        gl.value.bindBuffer(gl.value.ARRAY_BUFFER, layerObj.vbo);
        gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, layerObj.ebo);

        // === 设置顶点属性（只需一次）===
        // 1. 纹理程序的属性
        gl.value.useProgram(program.value);
        const posAttrib = gl.value.getAttribLocation(program.value, 'aPosition');
        const texAttrib = gl.value.getAttribLocation(program.value, 'aTexCoord');
        gl.value.enableVertexAttribArray(posAttrib);
        gl.value.enableVertexAttribArray(texAttrib);
        gl.value.vertexAttribPointer(posAttrib, 2, gl.value.FLOAT, false, 16, 0);
        gl.value.vertexAttribPointer(texAttrib, 2, gl.value.FLOAT, false, 16, 8);

        // 2. 颜色程序的属性
        gl.value.useProgram(colorProgram.value);
        const colorPosAttrib = gl.value.getAttribLocation(colorProgram.value, 'aPosition');
        gl.value.enableVertexAttribArray(colorPosAttrib);
        gl.value.vertexAttribPointer(colorPosAttrib, 2, gl.value.FLOAT, false, 16, 0);

        // 把圖層加到選取清單，讓 render2 能正常跑
        selectedLayers.value.push(i);
      }
      syncLayers();
      console.log(" sync layers checking size : ", glsInstance.layers.length);
      // 解绑所有缓冲区
      gl.value.bindBuffer(gl.value.ARRAY_BUFFER, null);
      gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, null);

      console.log("WebGL initialization complete");
      currentJobName = "png";

      // 启动渲染循环
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, "png");
    };

    const secondImage = async () => {

      console.log(" load first image ... ");
      // 加载纹理
      let result = await loadTexture(gl.value, './png4.png');
      texture.value = [];
      glsInstance.clearAllLayer();

      let layer = {
        imageData: result.data,
        width: result.width,
        height: result.height
      };

      let result2 = await loadTexture(gl.value, './png2.png');


      let layer2 = {
        imageData: result2.data,
        width: result2.width,
        height: result2.height
      };
      texture.value.push(await layerToTexture(gl.value, layer));
      texture.value.push(await layerToTexture(gl.value, layer2));

      let canvasHeight = layer.height;
      let canvasWidth = layer.width;
      glsInstance.addLayer("QQ");
      glsInstance.addLayer("ahaha");
      // === 初始化图层缓冲区和顶点属性 ===
      for (let i = 0; i < texture.value.length; i++) {

        glsInstance.createLayerBuffers(gl.value, texture.value[i].image, texture.value[i].width, texture.value[i].height, 1, -1, canvasWidth, canvasHeight, glsInstance.layers[i]);

        // 绑定当前图层的缓冲区
        const layer = glsInstance.layers[i];
        console.log("hi layer", layer);
        gl.value.bindBuffer(gl.value.ARRAY_BUFFER, layer.vbo);
        gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, layer.ebo);

        // === 设置顶点属性（只需一次）===
        // 1. 纹理程序的属性
        gl.value.useProgram(program.value);
        const posAttrib = gl.value.getAttribLocation(program.value, 'aPosition');
        const texAttrib = gl.value.getAttribLocation(program.value, 'aTexCoord');
        gl.value.enableVertexAttribArray(posAttrib);
        gl.value.enableVertexAttribArray(texAttrib);
        gl.value.vertexAttribPointer(posAttrib, 2, gl.value.FLOAT, false, 16, 0);
        gl.value.vertexAttribPointer(texAttrib, 2, gl.value.FLOAT, false, 16, 8);

        // 2. 颜色程序的属性
        gl.value.useProgram(colorProgram.value);
        const colorPosAttrib = gl.value.getAttribLocation(colorProgram.value, 'aPosition');
        gl.value.enableVertexAttribArray(colorPosAttrib);
        gl.value.vertexAttribPointer(colorPosAttrib, 2, gl.value.FLOAT, false, 16, 0);
      }



      // 解绑所有缓冲区
      gl.value.bindBuffer(gl.value.ARRAY_BUFFER, null);
      gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, null);

      console.log("WebGL initialization complete");
      currentJobName = "png2";
      // 启动渲染循环
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, "png2");
    }

    const psdImage = async () => {
      if (!gl.value) return;
      glsInstance.clearAllLayer();
      texture.value = [];

      let index = 0;
      let canvasHeight = wholeImageWidth;
      let canvasWidth = wholeImageHeight;

      for (const layerData of layersForTexture) {
        // === 1. 建立 WebGL 紋理 ===
        const texInfo = await layerToTexture(gl.value, layerData);
        texture.value.push(texInfo);

        // === 2. 建立 layer 實體 ===
        const layerName = "psd" + index;
        const layer = glsInstance.addLayer(layerName);
        index += 1;

        // === 3. 建立 attachment 並綁到 layer 上 ===
        const attachment = Attachment(layerData, texInfo.tex);
        layer.attachment = attachment;   // ✅ 新增這行，將 attachment 掛進 layer

        // === Log 檢查 attachment 是否正確建立 ===
        console.log(`Attachment for layer "${layer.name}" created:`);
        console.log({
          name: attachment.name,
          texture: attachment.texture ? "OK" : "NULL",
          width: attachment.width,
          height: attachment.height,
          verticesLength: attachment.vertices.length,
          indicesLength: attachment.indices.length,
          visible: attachment.visible,
          coords: attachment.coords
        });
      }

      // === 同步/初始化 ===
      syncLayers();
      selectedLayers.value = [];

      console.log(" glsInstance.layers size: ", glsInstance.layers.length);

      for (let i = 0; i < texture.value.length; i++) {
        const texInfo = texture.value[i];
        const layer = glsInstance.layers[i];

        // === 使用 layer.attachment 的資料代替 layerData ===
        const att = layer.attachment;
        glsInstance.createLayerBuffers(
          gl.value,
          att.image, att.width, att.height,
          att.top, att.left,
          canvasWidth, canvasHeight,
          layer
        );

        // === 維持原有的 attribute 綁定 ===
        gl.value.bindBuffer(gl.value.ARRAY_BUFFER, layer.vbo);
        gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, layer.ebo);

        gl.value.useProgram(program.value);
        const posAttrib = gl.value.getAttribLocation(program.value, 'aPosition');
        const texAttrib = gl.value.getAttribLocation(program.value, 'aTexCoord');
        gl.value.enableVertexAttribArray(posAttrib);
        gl.value.enableVertexAttribArray(texAttrib);
        gl.value.vertexAttribPointer(posAttrib, 2, gl.value.FLOAT, false, 16, 0);
        gl.value.vertexAttribPointer(texAttrib, 2, gl.value.FLOAT, false, 16, 8);

        gl.value.useProgram(colorProgram.value);
        const colorPosAttrib = gl.value.getAttribLocation(colorProgram.value, 'aPosition');
        gl.value.enableVertexAttribArray(colorPosAttrib);
        gl.value.vertexAttribPointer(colorPosAttrib, 2, gl.value.FLOAT, false, 16, 0);

        selectedLayers.value.push(i);
      }

      gl.value.bindBuffer(gl.value.ARRAY_BUFFER, null);
      gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, null);

      console.log("WebGL initialization complete");
      currentJobName = "psd";

      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, "psd");
    };
    const toggleLayerSelection = (index) => {
      if (chosenLayers.value.includes(index)) {
        chosenLayers.value = chosenLayers.value.filter(i => i !== index)
      } else {
        chosenLayers.value.push(index)
      }

      // set last input index as currentChosedLayer
      currentChosedLayer.value = index;

      //checking vertex group info
      console.log(" vertex group info : ", glsInstance.layers[index]?.vertexGroup.value);
      //check layer's parameter key name
      console.log(" layer parameter key name : ", Object.keys(glsInstance.layers[index] || {}));

    }

    const onVertexGroupChange = (event) => {

      selectedGroups.value = Array.from(event.target.selectedOptions).map(opt => opt.value);


      console.log(selectedValues.value); // 例如 ["a", "c"]
    };
    function printBoneHierarchy(bones, indent = 0) {
      for (const bone of bones) {
        //  console.log(`${' '.repeat(indent)}- ${bone.name}`);
        //display global head and tail
        const globalTransform = bone.getGlobalTransform();
        //  console.log(`${' '.repeat(indent + 2)}  Head: (${globalTransform.head.x.toFixed(2)}, ${globalTransform.head.y.toFixed(2)})`);
        //  console.log(`${' '.repeat(indent + 2)}  Tail: (${globalTransform.tail.x.toFixed(2)}, ${globalTransform.tail.y.toFixed(2)})`);
        // 遞迴列印子骨骼

        if (bone.children && bone.children.length > 0) {
          printBoneHierarchy(bone.children, indent + 2); // 遞迴
        }
      }
    }
    const bindingBoneWeight = (overlapFactor = 1) => {
      console.log(" Binding bone weight ... ");
      if (skeletons.length === 0) {
        console.warn("No skeletons available for binding.");
        return;
      }
      printBoneHierarchy(skeletons[0].bones);
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer) {
        console.error("Invalid layer index for binding bone weight.");
        return;
      }
      const vertices = layer.vertices.value;
      const vertexCount = vertices.length / 4;

      // 收集所有骨骼
      const allBones = [];
      function collectBones(bones) {
        for (const bone of bones) {
          allBones.push(bone);
          if (bone.children && bone.children.length > 0) {
            collectBones(bone.children);
          }
        }
      }
      collectBones(skeletons[0].bones);
      console.log(`Found ${allBones.length} bones and ${vertexCount} vertices`);

      // 清空舊的 vertex group
      layer.vertexGroup.value = [];
      const vertexGroupMap = new Map();

      // 計算點到骨頭線段的距離（改進版：考慮骨骼的影響範圍）
      function distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) {
          const distX = px - x1;
          const distY = py - y1;
          return Math.sqrt(distX * distX + distY * distY);
        }

        let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));

        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;
        const distX = px - closestX;
        const distY = py - closestY;

        return {
          distance: Math.sqrt(distX * distX + distY * distY),
          t: t  // 投影參數，0表示在head端，1表示在tail端
        };
      }

      // 計算骨骼的有效影響半徑（基於骨骼長度）
      function getBoneInfluenceRadius(bone) {
        const globalTransform = bone.getGlobalTransform();
        const dx = globalTransform.tail.x - globalTransform.head.x;
        const dy = globalTransform.tail.y - globalTransform.head.y;
        const boneLength = Math.sqrt(dx * dx + dy * dy);

        // 影響半徑 = 骨骼長度的一定比例 * overlapFactor
        // overlapFactor 越小，影響範圍越小
        return boneLength * 0.5 * overlapFactor;
      }

      // === 主迴圈 ===
      for (let i = 0; i < vertexCount; i++) {
        const vx = vertices[i * 4];
        const vy = vertices[i * 4 + 1];

        const candidates = [];

        for (let j = 0; j < allBones.length; j++) {
          const bone = allBones[j];
          const globalTransform = bone.getGlobalTransform();
          const result = distanceToSegment(
            vx, vy,
            globalTransform.head.x, globalTransform.head.y,
            globalTransform.tail.x, globalTransform.tail.y
          );

          const influenceRadius = getBoneInfluenceRadius(bone);

          // 只考慮在影響範圍內的骨骼
          if (result.distance <= influenceRadius) {
            // 計算權重：距離越近權重越高
            // 使用平滑的衰減函數
            const normalizedDist = result.distance / influenceRadius;
            const weight = Math.pow(1.0 - normalizedDist, 3); // 立方衰減，更銳利

            candidates.push({
              boneIndex: j,
              boneName: bone.name,
              distance: result.distance,
              weight: weight,
              t: result.t
            });
          }
        }

        // 如果沒有骨骼在影響範圍內，選擇最近的那個
        if (candidates.length === 0) {
          let minDist = Infinity;
          let closestBone = null;

          for (let j = 0; j < allBones.length; j++) {
            const bone = allBones[j];
            const globalTransform = bone.getGlobalTransform();
            const result = distanceToSegment(
              vx, vy,
              globalTransform.head.x, globalTransform.head.y,
              globalTransform.tail.x, globalTransform.tail.y
            );

            if (result.distance < minDist) {
              minDist = result.distance;
              closestBone = {
                boneIndex: j,
                boneName: bone.name,
                distance: result.distance,
                weight: 1.0,
                t: result.t
              };
            }
          }

          if (closestBone) {
            candidates.push(closestBone);
          }
        }

        // 正規化權重
        let totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
        if (totalWeight > 0) {
          candidates.forEach(c => c.weight /= totalWeight);
        }

        // 只保留權重較大的骨骼（進一步減少影響的骨骼數量）
        const threshold = 0.05; // 權重小於5%的忽略
        const finalBones = candidates.filter(c => c.weight >= threshold);

        // 再次正規化
        totalWeight = finalBones.reduce((sum, c) => sum + c.weight, 0);
        if (totalWeight > 0) {
          finalBones.forEach(c => c.weight /= totalWeight);
        }

        // === 存到 vertex group ===
        finalBones.forEach(item => {
          const boneName = item.boneName;
          if (!vertexGroupMap.has(boneName)) {
            vertexGroupMap.set(boneName, { name: boneName, vertices: [] });
          }
          const group = vertexGroupMap.get(boneName);
          const existingVertex = group.vertices.find(v => v.id === i);
          if (existingVertex) {
            existingVertex.weight += item.weight;
          } else {
            group.vertices.push({ id: i, weight: item.weight });
          }
        });
      }

      layer.vertexGroup.value = Array.from(vertexGroupMap.values());
      console.log("Updated vertex group info:", JSON.stringify(layer.vertexGroup.value));
      console.log(`Average bones per vertex: ${layer.vertexGroup.value.reduce((sum, g) => sum + g.vertices.length, 0) / vertexCount
        }`);
    };
    const vertexGroupInfo = computed(() => {
      refreshKey.value; // 強制刷新
      console.log(" currentChosedLayer value : ", currentChosedLayer.value, ", layer size: ", glsInstance.layers.length);
      return glsInstance.layers[currentChosedLayer.value]?.vertexGroup.value
    })

    const drawAgain = () => {
      drawGlCanvas();
    };

    const editingGroup = ref(null);   // 目前正在編輯的 group 名稱
    const editName = ref("");         // 暫存輸入的名字

    // 切換選中 / 取消選中
    const toggleSelect = (name) => {


      //temporary only one selection
      if (selectedGroups.value.includes(name)) {
        selectedGroups.value = [];
      } else {
        selectedGroups.value = [name];
      }

      //show selected vertices info
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;
      const selectedGroupName = selectedGroups.value[0];
      const group = layer.vertexGroup.value.find(g => g.name === selectedGroupName);
      if (!group) return;
      console.log("Selected vertices from group:", JSON.stringify(group));

      /*
      if (selectedGroups.value.includes(name)) {
        selectedGroups.value = selectedGroups.value.filter(n => n !== name);
      } else {
        selectedGroups.value.push(name);

      }
        */
    };

    // 開始編輯
    const startEdit = (name) => {
      editingGroup.value = name;
      editName.value = name; // 預設是舊名字
    };

    // 確認編輯
    const confirmEdit = (group) => {
      if (editName.value.trim() !== "") {
        group.name = editName.value.trim();
      }
      editingGroup.value = null;
      editName.value = "";
    };
    const onAdd = () => {
      console.log("on add vertex group info!");
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;

      layer.vertexGroup.value.push({
        name: "group" + (layer.vertexGroup.value.length + 1),
        vertices: [] // 預設空陣列
      });
    };
    const onRemove = () => {
      console.log("on remove vertex group info!");
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup)
        return; // 只留下沒有被選中的 group 
      layer.vertexGroup.value = layer.vertexGroup.value.filter(g => !selectedGroups.value.includes(g.name)); // 清空已刪掉的選擇，避免選到不存在的 group 
      selectedGroups.value = [];
    };
    const onAssign = () => {
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;

      const selectedGroupName = selectedGroups.value[0];
      const group = layer.vertexGroup.value.find(g => g.name === selectedGroupName);
      if (!group) return;

      group.vertices = selectedVertices.value.map(idx => ({
        id: idx,       // 直接用數字 index
        weight: 0.0
      }));

      console.log("Assigned vertices to group:", group);
      console.log("Updated vertex group info:", layer.vertexGroup.value);
    };

    const onSelect = () => {
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;

      const selectedGroupName = selectedGroups.value[0];
      const group = layer.vertexGroup.value.find(g => g.name === selectedGroupName);
      if (!group) return;

      selectedVertices.value = group.vertices.map(v => v.id);

      console.log("Selected vertices from group:", selectedVertices.value);
    };
    const weightValue = ref(0.0);



    const setWeight = () => {
      const weight = parseFloat(weightValue.value);
      if (isNaN(weight) || weight < 0 || weight > 1) {
        alert("請輸入介於 0.0 到 1.0 之間的數值");
        return;
      }
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;

      const selectedGroupName = selectedGroups.value[0];
      const group = layer.vertexGroup.value.find(g => g.name === selectedGroupName);
      if (!group) return;

      // 加上這個檢查！
      // 確認 group.vertices 存在並且是一個陣列
      if (!group.vertices || !Array.isArray(group.vertices)) {
        console.error("錯誤：選中的 group 沒有 vertices 陣列可供操作。", group);
        return; // 提早結束函式，避免崩潰
      }

      // 現在可以安全地執行 forEach 了
      group.vertices.forEach(v => {
        v.weight = weight;
      });

      console.log("Updated vertex group info:", JSON.stringify(layer.vertexGroup.value));
    };


    //animate vertex function (not yet done )
    const tryAnimatedVertex = () => {
      const uTransformMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // 你的投影/模型矩陣
      drawSkinnedMesh(gl, skinnedProgram, glsInstance.layers[currentChosedLayer.value], skeletons[0], uTransformMatrix);
    }
    function drawSkinnedMesh(gl, program, layer, skeleton, uTransformMatrix) {
      const vertices = layer.vertices.value; // 原始頂點 x,y
      const texCoords = layer.texCoords.value; // uv
      const vertexCount = vertices.length / 2;

      // -----------------------------
      // 1️⃣ 準備 Bone Skinning 資料
      // -----------------------------
      const aBoneIndices = new Float32Array(vertexCount * 4);
      const aBoneWeights = new Float32Array(vertexCount * 4);

      for (let i = 0; i < vertexCount; i++) {
        const groups = layer.vertexGroup.value
          .map(g => g.vertices.find(v => v.id === i))
          .filter(v => v)
          .slice(0, 4); // 最多 4 骨骼

        for (let j = 0; j < 4; j++) {
          if (groups[j]) {
            const bIndex = skeleton.bones.findIndex(b => b.name === layer.vertexGroup.value[j].name);
            aBoneIndices[i * 4 + j] = bIndex;
            aBoneWeights[i * 4 + j] = groups[j].weight;
          } else {
            aBoneIndices[i * 4 + j] = 0;
            aBoneWeights[i * 4 + j] = 0;
          }
        }
      }

      // -----------------------------
      // 2️⃣ 更新骨骼矩陣到 Bone Texture
      // -----------------------------
      const boneCount = skeleton.bones.length;
      const boneTextureData = new Float32Array(boneCount * 4 * 4);
      for (let i = 0; i < boneCount; i++) {
        const m = skeleton.bones[i].getWorldMatrix(); // 16 element flat array
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 4; col++) {
            boneTextureData[i * 16 + row * 4 + col] = m[row * 4 + col];
          }
        }
      }

      const boneTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, boneTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, boneCount, 0, gl.RGBA, gl.FLOAT, boneTextureData);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      // -----------------------------
      // 3️⃣ 綁定 shader attribute & uniform
      // -----------------------------
      gl.useProgram(program);

      const aPositionLoc = gl.getAttribLocation(program, "aPosition");
      const aTexCoordLoc = gl.getAttribLocation(program, "aTexCoord");
      const aBoneIndicesLoc = gl.getAttribLocation(program, "aBoneIndices");
      const aBoneWeightsLoc = gl.getAttribLocation(program, "aBoneWeights");
      const uTransformLoc = gl.getUniformLocation(program, "uTransform");
      const uBoneTextureLoc = gl.getUniformLocation(program, "uBoneTexture");
      const uBoneTextureSizeLoc = gl.getUniformLocation(program, "uBoneTextureSize");

      // 顯示矩陣
      gl.uniformMatrix4fv(uTransformLoc, false, uTransformMatrix);

      // Bone Texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, boneTexture);
      gl.uniform1i(uBoneTextureLoc, 0);
      gl.uniform1f(uBoneTextureSizeLoc, boneCount * 4.0);

      // -----------------------------
      // 4️⃣ 綁定頂點 buffer
      // -----------------------------
      function bindArrayBuffer(data, loc, size) {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      }

      bindArrayBuffer(vertices, aPositionLoc, 2);
      bindArrayBuffer(texCoords, aTexCoordLoc, 2);
      bindArrayBuffer(aBoneIndices, aBoneIndicesLoc, 4);
      bindArrayBuffer(aBoneWeights, aBoneWeightsLoc, 4);

      // -----------------------------
      // 5️⃣ draw call
      // -----------------------------
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    //timeline series function
    const timelineDragging = ref(false);
    const playheadPosition = ref(null);

    const selectTimeline = (event) => {
      const timelineRect = event.currentTarget.getBoundingClientRect();
      let offsetX = event.clientX - timelineRect.left;
      const clampedX = Math.max(0, Math.min(offsetX, timelineRect.width));

      const updateTimeline = () => {
        timeline2.value.update(playheadPosition.value, skeletons);
        bonesInstance.updatePoseMesh(gl.value);
        forceUpdate();
      }

      //maybe I should update bone-pose (for animation here)

      switch (event.type) {
        case 'mousedown':
          timelineDragging.value = true;
          const handleMouseUp = (e) => {
            timelineDragging.value = false;
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousemove', handleMouseMove);
            updateTimeline();
          };
          const handleMouseMove = (e) => {
            if (timelineDragging.value) {
              offsetX = e.clientX - timelineRect.left;
              playheadPosition.value = Math.max(0, Math.min(offsetX, timelineRect.width));

              updateTimeline();
            }
          };
          document.addEventListener('mouseup', handleMouseUp);
          document.addEventListener('mousemove', handleMouseMove);
          playheadPosition.value = clampedX;
          updateTimeline();
          break;
        case 'mousemove':
          if (timelineDragging.value) {
            playheadPosition.value = clampedX;
            updateTimeline();
          }
          break;
        case 'mouseup':
          timelineDragging.value = false;
          break;
      }



    };
    const addKeyframe = () => {
      timeline2.value.addKeyframe(bonesInstance.GetLastSelectedBone?.(), playheadPosition.value);

      console.log("check now timeline data : ", JSON.stringify(timeline2.value));
    }
    const removeKeyframe = () => {
    }

    const selectBoneByKey = (boneId) => {
      lastSelectedBone.value = bonesInstance.findBoneById(boneId);

      console.log("now last select bone is ", lastSelectedBone.value.id);

    }

    const exportSkeletonToSpineJson = () => {
      let result = meshSkeleton.exportSpineJson();
      console.log(" hi spine json : ", JSON.stringify(result));

    }
    const saveSpineJson = () => {
      meshSkeleton.exportToFile();

      const imageName = "alien.png";
      const imageSize = { width: 500, height: 768 };
      const regionBounds = {
        Bone_1: { x: 0, y: 0, width: 500, height: 768 },
        Bone_2: { x: 0, y: 0, width: 500, height: 768 },
        Bone_3: { x: 0, y: 0, width: 500, height: 768 }
      };

      // 產生 Atlas
      meshSkeleton.exportAtlasFile("alien.atlas", imageName, imageSize, regionBounds);

    }
    const playAnimation = () => {
      console.log("hi play animation! ");
    }

    const addTimeline = () => {
      const newName = `動畫軸 ${timelineList.value.length + 1}`;
      timelineList.value.push(new Timeline2(newName, 2.0));
      selectedTimelineId.value = timelineList.value.length - 1;
    };
    const removeTimeline = () => {
      if (timelineList.length > 1) {
        timelineList.splice(selectedTimelineId, 1);
        selectedTimelineId = Math.max(0, selectedTimelineId - 1);
      }
    }

    const choseTimelineId = () => {
      console.log("hi select timeline ID ", selectedTimelineId);
    }
    onMounted(async () => {

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      try {
        drawGlCanvas();
      } catch (error) {
        console.error("Initialization error:", error);
      }
    });
    watch(selectedLayers, (newVal) => {
      console.log("勾選的圖層:", JSON.stringify(newVal)); // 這裡可以 emit 或呼叫父組件的方法
    });
    const currentTimeline = computed(() => timelineList.value[selectedTimelineId.value]);
    return {
      selectTool,
      activeTool,
      resetPose,
      drawAgain,
      skeletons,
      toggleNode,
      expandedNodes,
      handleNameClick,
      lastSelectedBone,
      psdImage,
      secondImage,
      firstImage,
      showLayers,
      selectedLayers,
      chosenLayers,
      toggleLayerSelection,
      currentChosedLayer,
      vertexGroupInfo,
      onVertexGroupChange,
      onAdd,
      onRemove,
      selectedGroups,
      editingGroup,
      editName,
      toggleSelect,
      startEdit,
      confirmEdit,
      onAssign,
      onSelect,
      setWeight,
      weightValue,
      bindingBoneWeight,
      timeline2,
      selectTimeline,
      playheadPosition,
      addKeyframe,
      removeKeyframe,
      selectBoneByKey,
      exportSkeletonToSpineJson,
      saveSpineJson,
      timelineList,
      selectedTimelineId,
      choseTimelineId,
      addTimeline,
      removeTimeline,
      currentTimeline,
      playAnimation,
      counter
    };
  }
});
const TreeItem = {
  props: ['node', 'expandedNodes', 'selectedItem'],
  emits: ['toggle-node', 'item-click'],
  template: `
    <div class="tree-item">
      <!-- Bone 標題 -->
      <div class="tree-item-header" style="display: flex; align-items: center;">
        <!-- 展開箭頭 -->
        <span v-if="hasChildren || hasSlots"
          style="cursor: pointer; width: 16px; display: inline-block;"
          @click.stop="toggleNode(node.id)">
          {{ isExpanded ? '▼' : '▶' }}
        </span>
        <span v-else style="display:inline-block; width:16px;"></span>

        <!-- Bone 名稱 -->
        <span
          :style="{
            backgroundColor: selectedItem?.type === 'bone' && selectedItem?.id === node?.id ? 'gray' : 'transparent'
          }"
          style="cursor: pointer;"
          @click="selectItem({ type: 'bone', id: node?.id })"
        >
          🦴 {{ node?.name || '(未命名骨骼)' }}
        </span>
      </div>

      <!-- 展開內容 -->
      <div v-if="isExpanded" class="tree-item-children" style="padding-left: 16px;">
        <!-- Slot -->
        <div v-for="slot in node.slots" :key="slot.id"
             style="cursor:pointer; padding:2px;"
             :style="{ backgroundColor: selectedItem?.type === 'slot' && selectedItem?.id === slot.id ? 'gray' : 'transparent' }"
             @click="selectItem({ type: 'slot', id: slot.id })">
          🎯 Slot: {{ slot.name }}
        </div>

        <!-- 子 Bone -->
        <tree-item
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :expanded-nodes="expandedNodes"
          :selected-item="selectedItem"
          @toggle-node="$emit('toggle-node', $event)"
          @item-click="$emit('item-click', $event)"
        />
      </div>
    </div>
  `,
  computed: {
    hasChildren() {
      return this.node.children && this.node.children.length > 0;
    },
    hasSlots() {
      return this.node.slots && this.node.slots.length > 0;
    },
    isExpanded() {
      return this.expandedNodes.includes(this.node.id);
    }
  },
  methods: {
    toggleNode(nodeId) {
      this.$emit('toggle-node', nodeId);
    },
    selectItem(item) {
      this.$emit('item-click', item);
    }
  }
};
const { createRouter, createWebHashHistory } = VueRouter;
    const Home = { template: '<h1>首頁</h1>' };
    const Editor = { template: '<h1>編輯器</h1>' };

    const routes = [
      { path: '/', component: Home },
      { path: '/editor', component: Editor },
    ];

    const router = createRouter({
      history: createWebHashHistory(),
      routes,
    });

app.component('tree-item', TreeItem);
const pinia = createPinia();
app.use(pinia);
app.use(router)

export default app;