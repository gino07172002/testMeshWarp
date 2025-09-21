const { createApp, onMounted, ref, reactive } = Vue;
export const selectedBone = ref(-1);
export const boneIdToIndexMap = reactive({});
export const boneTree = reactive({});
import {
  //initBone,
  skeletonVertices,
  boneParents,
  boneChildren,
  meshSkeleton,
  skeletons,
  lastSelectedBone
} from './useBone.js';

import {
  gl,
  texture,
  program,
  colorProgram,
  skeletonProgram,

  indices,
  linesIndices
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
      `
};
// 準備多圖層資料結構陣列
let layersForTexture = [];
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
    glsInstance.createBuffers2(gl.value);

    // 若骨架數據與圖片相關，需重新初始化

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


    // 為每個圖層創建紋理，並存儲為數組
    texture.value = await Promise.all(layersToRender.map(layer => layerToTexture(gl.value, layer)));

    console.log(" texture layers length : ", texture.value.length);

    console.log(" =================================== start adding layers ");
    for (let i = 0; i < texture.value.length; i++) {
      console.log(" hi loading gl value : ", i);
      glsInstance.createLayerBuffers(texture.value[i]);

      // 绑定当前图层的缓冲区
      const layer = glsInstance.layers[i];
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

    // 为第0层设置线条缓冲区
    if (glsInstance.getLayerSize() > 0) {
      gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, glsInstance.layers[0].eboLines);
      gl.value.bufferData(gl.value.ELEMENT_ARRAY_BUFFER, new Uint16Array(linesIndices.value), gl.value.STATIC_DRAW);
    }

    // 解绑所有缓冲区
    gl.value.bindBuffer(gl.value.ARRAY_BUFFER, null);
    gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, null);

    console.log("WebGL initialization complete");

    // 启动渲染循环
    render2(gl.value, program.value, colorProgram.value, skeletonProgram.value);


    //console.log(" end adding layers =================================== ");
    // console.log(" hi texture : ", texture.value);

    // 根據新圖片尺寸重新建立頂點緩衝（假設所有圖層共享相同網格）
    // glsInstance.createBuffers2(gl.value);

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
    // 解析 Promise，返回紋理 all coordinate needed
    console.log(" top : ",layer.top," , left: ",layer.left);
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
    this.addLayer();
    this.addLayer();
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
    forceUpdate() {
      this.refreshKey++;
    },
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
          await processPSDFile(file);
          this.psdLayers = allLayers;
          console.log("Loaded PSD layers:", JSON.stringify(this.psdLayers[0].width));

          let imageWidth = this.psdLayers[0].width;
          let imageHeight = this.psdLayers[0].height;
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
              console.log("let see new psd layer: ",layer.top," , ",layer.left);


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
    const instance = Vue.getCurrentInstance();
    const mousePressed = ref(); // e event of mouse down , ex: 0:left, 2:right
    const refreshKey = ref(0);
    const expandedNodes = reactive([]);

    let currentJobName = null;
    const timeline = reactive(new Timeline({
      onUpdate: () => instance.proxy.$forceUpdate(),
      vueInstance: instance,
      updateMeshForSkeletonPose: glsInstance.updateMeshForSkeletonPose,
    }));
    const forceUpdate = () => {
      refreshKey.value++; // 每次加 1 → 會觸發 template 重新渲染
    };
    function toggleNode(nodeId) {
      const idx = expandedNodes.indexOf(nodeId);
      if (idx >= 0) {
        expandedNodes.splice(idx, 1);
      } else {
        expandedNodes.push(nodeId);
      }
    };

    function handleNameClick(boneId) {
      selectedBone.value = boneId; // 或做你原本選骨骼的處理
      bonesInstance.findBoneById(boneId);
    };
    const bonesInstance = new Bones({
      onUpdate: () => instance.proxy.$forceUpdate(),
      vueInstance: instance,
      gl: gl.value,
      selectedBone: selectedBone,
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
        glsInstance.resetMeshToOriginal();
        // bonesInstance.resetSkeletonToOriginal();
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

    const resetPose = () => {
      //bonesInstance.resetPoseToOriginal()
    }

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
      let alreadySelect = false;
      let localSelectedVertex = -1;
      let startPosX = 0;
      let startPosY = 0;

      const handleMouseDown = (e) => {
        mousePressed.value = e.button;
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);
        startPosX = xNDC;
        startPosY = yNDC;

        if (e.button === 0 || e.button === 2) {
          if (activeTool.value === 'grab-point') {
            /*
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
              */
          } else if (activeTool.value === 'bone-create') {
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

        if (activeTool.value === 'grab-point' && localSelectedVertex !== -1) {
          /*
          const index = localSelectedVertex * 4;
          vertices.value[index] = xNDC;
          vertices.value[index + 1] = yNDC;
          //    gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
          gl.bufferSubData(gl.ARRAY_BUFFER, index * 4, new Float32Array([xNDC, yNDC]));
          */
        } else if (activeTool.value === 'bone-create') {

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
          // console.log(" xNDC: ",xNDC," , yNDC",yNDC);
          //   startPosX = xNDC;
          //    startPosY = yNDC;
        }
      };

      const handleMouseUp = (e) => {
        if (activeTool.value === 'bone-create' && isDragging) {
          const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);

          if (e.button === 2) { //edit selected bone
            bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
          }
          else {
            bonesInstance.MeshBoneCreate(xNDC, yNDC);
          }


          //bonesInstance.assignVerticesToBones();
        } else if (activeTool.value === 'bone-animate' && isDragging) {
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
      const layerCount = textures.length;

      gl.useProgram(program);

      //console.log(" layer count : ",layerCount);
      for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
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
        
        const glLeft = (left / canvasWidth) * 2 - 1;
        const glRight = ((left + width) / canvasWidth) * 2 - 1;
        const glTop = 1 - (top / canvasHeight) * 2;
        const glBottom = 1 - ((top + height) / canvasHeight) * 2;
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
          tx,ty, 0, 1
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
        gl.drawElements(gl.TRIANGLES, indices.value.length, gl.UNSIGNED_SHORT, 0);
      }

      // === 在所有圖層之後渲染格線/骨架 ===
      renderGridOnly(gl, colorProgram, skeletonProgram);

      // 下一幀
      requestAnimationFrame(() =>
        render2(gl, program, colorProgram, skeletonProgram, renderLayer, jobName)
      );
    };

    // 辅助函数：更新图层顶点
    function updateLayerVertices(gl, layer, layerIndex) {
      if (!layer.vertices.value || !layer.originalVertices.value) {
        console.warn(`Layer ${layerIndex} missing vertex data`);
        return;
      }

      const originalVertices = layer.originalVertices.value;
      const updatedVertices = new Float32Array(originalVertices.length);

      for (let j = 0; j < originalVertices.length; j += 4) {
        const x = originalVertices[j];
        const y = originalVertices[j + 1];
        const u = originalVertices[j + 2];
        const v = originalVertices[j + 3];

        // 暂时禁用动画，先确保基础渲染正常
        const wave = 0; // Math.sin(x * 10 + time + layerIndex * Math.PI / 4) * 0.05;

        updatedVertices[j] = x;
        updatedVertices[j + 1] = y + wave;
        updatedVertices[j + 2] = u;
        updatedVertices[j + 3] = v;
      }

      // 更新VBO
      gl.bufferData(gl.ARRAY_BUFFER, updatedVertices, gl.DYNAMIC_DRAW);
      layer.vertices.value = updatedVertices;
    }

    // 辅助函数：只渲染网格
    function renderGridOnly(gl, colorProgram, skeletonProgram) {
      if (glsInstance.getLayerSize() === 0) return;

      const baseLayer = glsInstance.layers[0];
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
      if (baseLayer.eboLines && linesIndices.value && linesIndices.value.length > 0) {
        gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 1, 1, 0.3);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, baseLayer.eboLines);
        gl.drawElements(gl.LINES, linesIndices.value.length, gl.UNSIGNED_SHORT, 0);
      }

      // 渲染顶点
      if (baseLayer.vertices.value && baseLayer.vertices.value.length > 0) {
        gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 0, 0, 1);
        const pointSizeLocation = gl.getUniformLocation(colorProgram, 'uPointSize');
        if (pointSizeLocation !== null) {
          gl.uniform1f(pointSizeLocation, 3.0);
        }
        gl.drawArrays(gl.POINTS, 0, baseLayer.vertices.value.length / 4);
      }

      // === 渲染骨架 ===
      if (typeof renderMeshSkeleton === 'function' && meshSkeleton) {
        renderMeshSkeleton(gl, skeletonProgram, meshSkeleton);
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


    // 提取的骨架渲染函數
    const renderSkeleton = (gl, skeletonProgram) => {
      if (skeletonVertices.value.length === 0) return;

      // 保存當前WebGL狀態
      const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const prevElementBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
      const prevBlend = gl.getParameter(gl.BLEND);

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

      // 恢復WebGL狀態
      gl.useProgram(prevProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prevElementBuffer);

      if (prevBlend) {
        gl.enable(gl.BLEND);
      } else {
        gl.disable(gl.BLEND);
      }
    };

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
      setupCanvasEvents(canvas, gl.value, container);

      // 创建着色器程序
      program.value = glsInstance.createProgram(gl.value, shaders.vertex, shaders.fragment);
      colorProgram.value = glsInstance.createProgram(gl.value, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = glsInstance.createProgram(gl.value, shaders.skeletonVertex, shaders.skeletonFragment);


      firstImage();
    };

    const firstImage = async () => {

      console.log(" load first image ... ");
      // 加载纹理
      let result = await loadTexture(gl.value, './png3.png');
      texture.value = [];

      let layer = {
        imageData: result.data,
        width: result.width,
        height: result.height
      };
      texture.value.push(await layerToTexture(gl.value, layer));
      glsInstance.addLayer("QQ");
      let canvasHeight = layer.height;
      let canvasWidth = layer.width;
      // === 初始化图层缓冲区和顶点属性 ===
      for (let i = 0; i < texture.value.length; i++) {
        glsInstance.createLayerBuffers(gl.value, texture.value[i].image, texture.value[i].width, texture.value[i].height, 1, -1, canvasWidth, canvasHeight);

        // 绑定当前图层的缓冲区
        const layer = glsInstance.layers[i];
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

      // 为第0层设置线条缓冲区
      if (glsInstance.getLayerSize() > 0) {
        gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, glsInstance.layers[0].eboLines);
        gl.value.bufferData(gl.value.ELEMENT_ARRAY_BUFFER, new Uint16Array(linesIndices.value), gl.value.STATIC_DRAW);
      }

      // 解绑所有缓冲区
      gl.value.bindBuffer(gl.value.ARRAY_BUFFER, null);
      gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, null);

      console.log("WebGL initialization complete");
      currentJobName = "png";
      // 启动渲染循环
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, "png");
    }

    const secondImage = async () => {

      console.log(" load first image ... ");
      // 加载纹理
      let result = await loadTexture(gl.value, './png4.png');
      texture.value = [];

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
        glsInstance.createLayerBuffers(gl.value, texture.value[i].image, texture.value[i].width, texture.value[i].height, 1, -1, canvasWidth, canvasHeight);

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

      // 为第0层设置线条缓冲区
      if (glsInstance.getLayerSize() > 0) {
        gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, glsInstance.layers[0].eboLines);
        gl.value.bufferData(gl.value.ELEMENT_ARRAY_BUFFER, new Uint16Array(linesIndices.value), gl.value.STATIC_DRAW);
      }

      // 解绑所有缓冲区
      gl.value.bindBuffer(gl.value.ARRAY_BUFFER, null);
      gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, null);

      console.log("WebGL initialization complete");
      currentJobName = "png2";
      // 启动渲染循环
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, "png2");
    }

    const psdImage = async (layerIndices = []) => {
      if (!gl.value) return;

      texture.value = [];
      // 現在您可以使用這個陣列來建立紋理
      let index = 0;
      for (const layerData of layersForTexture) {
        console.log(" layer data image scale info : ", layerData.width, " , ", layerData.height, " , layerData.top : ", layerData.top, " , ", layerData.left);
        texture.value.push(await layerToTexture(gl.value, layerData));
        glsInstance.addLayer("psd" + index);
        index += 1;
      }

      // 或者如果您想要單獨處理每個圖層：
      // for (let i = 0; i < layersForTexture.length; i++) {
      //   const layerTexture = await layerToTexture(gl.value, layersForTexture[i]);
      //   texture.value.push(layerTexture);
      //   console.log(`Layer ${i} texture created:`, layerTexture);
      // }

      console.log("checking anything in all layers ", allLayers);
      // 确定要处理的图层
      /*
      const psdLayers = layerIndices.length > 0
        ? layerIndices.map(index => allLayers[index])
        : allLayers;
        */
      let canvasHeight = texture.value[0].height;
      let canvasWidth = texture.value[0].width;


      console.log(" image expected size : ", texture.value[0].height, " , ", texture.value[0].width);
      for (let i = 0; i < texture.value.length; i++)
      // for (let i = 0; i < 1; i++) 
      {
        glsInstance.createLayerBuffers(gl.value, texture.value[i].image, texture.value[i].width, texture.value[i].height, texture.value[i].top, texture.value[i].left, canvasWidth, canvasHeight);

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

      // 为第0层设置线条缓冲区
      if (glsInstance.getLayerSize() > 0) {
        gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, glsInstance.layers[0].eboLines);
        gl.value.bufferData(gl.value.ELEMENT_ARRAY_BUFFER, new Uint16Array(linesIndices.value), gl.value.STATIC_DRAW);
      }

      // 解绑所有缓冲区
      gl.value.bindBuffer(gl.value.ARRAY_BUFFER, null);
      gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, null);

      console.log("WebGL initialization complete");
      currentJobName = "psd";
      // 启动渲染循环
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, "psd");
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
      resetPose,
      drawAgain,
      skeletons,
      toggleNode,
      expandedNodes,
      handleNameClick,
      lastSelectedBone,
      psdImage,
      secondImage,
      firstImage
    };
  }
});

const TreeItem = {
  props: ['node', 'expandedNodes', 'selectedBone'],
  template: `
    <div class="tree-item">
  <div class="tree-item-header" style="display: flex; align-items: center;">
    <!-- 箭頭按鈕 -->
    <span v-if="hasChildren"
          style="cursor: pointer; width: 16px; display: inline-block;"
          @click.stop="toggleNode(node.id)">
      {{ isExpanded ? '▼' : '▶' }}
    </span>

    <!-- 名稱文字 -->
    <span style="cursor: pointer;" @click="selectBone(node.id)">
      {{ node.name }}
    </span>
  </div>

  <!-- 子節點 -->
  <div v-if="isExpanded" class="tree-item-children" style="padding-left: 16px;">
    <tree-item
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :expanded-nodes="expandedNodes"
      :selected-bone="selectedBone"
      @toggle-node="$emit('toggle-node', $event)"
      @name-click="$emit('name-click', $event)"
    />
  </div>
</div>
  `,
  computed: {
    hasChildren() {
      return this.node.children && this.node.children.length > 0;
    },
    isExpanded() {
      return this.expandedNodes.includes(this.node.id);
    }
  },
  methods: {
    toggleNode(nodeId) {
      this.$emit('toggle-node', nodeId);
    },
    selectBone(boneId) {
      this.$emit('name-click', boneId);
    }
  }
};




app.component('tree-item', TreeItem);
export default app;