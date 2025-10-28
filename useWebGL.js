// useWebGL.js
const { ref, reactive } = Vue;

import {
  // initBone,

} from './useBone.js';


import {
  Mesh2D,
  Bone,
  Attachment
} from './mesh.js';
// 📦 全局狀態區 (State)
const gl = ref(null);                    // WebGL 上下文
const texture = ref(null);               // 紋理
const program = ref(null);               // 主著色器程序
const colorProgram = ref(null);          // 顏色著色器程序
const skeletonProgram = ref(null);       // 骨骼著色器程序
const weightPaintProgram = ref(null);
const skinnedProgram = ref(null);
const layerForTextureWebgl = ref([]);
const currentJobName = ref(null);;

export const loadedImage = ref(null);
// Shader sources
export const shaders = {
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


const transparentCells = ref(new Set()); // Store transparent cells

const configSettings = reactive({        // 響應式配置
  imageSrc: './png3.png',                // 圖片來源
  rows: 10,                              // 網格行數
  cols: 10                               // 網格列數
});


// Helper to check if an area is fully transparent
const isAreaTransparent = (x, y, w, h, imageData, imageWidth, imageHeight) => {
  if (!imageData) {
    console.log("no image data...");
    return false;
  }

  const width = imageWidth;
  const height = imageHeight;

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
      if (imageData[pixelIndex] > 0) {
        return false;
      }
    }
  }

  // If we get here, all pixels had zero alpha
  return true;
};



export function Layer() {  //maybe layer would become spine2d's slot later
  const image = ref(null);
  const name = ref('');
  const visible = ref(true);
  const vertices = ref([]);                // 當前頂點數據
  const poseVertices = ref([]);        // vertex after bone pose applied
  const indices = ref([]);                 // 三角形索引
  const linesIndices = ref([]);
  const vertexGroup = ref([
    //   { name: "group1" },
    //    { name: "group2" },
    //   { name: "group3" }
  ]);
  const opacity = ref(1.0);
  //for spine2d's format compatibility
  const attachment = ref(null);  // 綁定貼圖或 mesh
  const drawOrder = ref(0);
  const color = ref([1, 1, 1, 1]);


  function loadImage(url) {
    image.value = url;
    console.log(`Image loaded: ${url}`);
  }




  return {
    image,
    name,
    visible,
    loadImage,
    vertices,
    poseVertices,
    indices,
    linesIndices,
    vertexGroup,
    opacity
  };
}


class gls {

  constructor() {
    // 存储所有图层的数组 (响应式)
    this.layers = [];
    this.refLayers = [];

    // 按名称索引的图层映射
    this.layerMap = {};

    /*
    this.addLayer("haha");
    this.addLayer("haha2");
    const tempLayer = this.getLayer("haha");
    console.log("test get layer:", {
      name: tempLayer.name.value,
      visible: tempLayer.visible.value,
      image: tempLayer.image.value
    });
    */


  };

  addLayer(layerName) {
    const newLayer = Layer();
    newLayer.name.value = layerName;

    this.layers.push(newLayer);
    this.layerMap[layerName] = newLayer;

    const newRedLayer = Layer();
    newRedLayer.name.value = layerName + 'ref';
    newRedLayer.opacity.value = 0.3;

    this.refLayers.push(newRedLayer);

    console.log(`Layer added: ${layerName}`);
    console.log(" layer parameter key name : ", Object.keys(newLayer));

    return newLayer;
  };
  clearAllLayer() {
    this.layers = [];
  }

  getLayer(layerName) {
    return this.layerMap[layerName] || null;
  };

  getLayerSize() {
    return this.layers.length;
  };

  compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compilation failed:', gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };

  createProgram(gl, vsSource, fsSource) {
    const vertexShader = this.compileShader(gl, vsSource, gl.VERTEX_SHADER);
    const fragmentShader = this.compileShader(gl, fsSource, gl.FRAGMENT_SHADER);

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

  // 計算網格頂點與索引
  generateGridVertices(image, width, height, top, left, canvasWidth, canvasHeight, rows = 10, cols = 10, customVertexFunc = null) {
    if (customVertexFunc) {
      return customVertexFunc({ image, width, height, top, left, canvasWidth, canvasHeight, rows, cols });
    }
    const glLeft = left;
    const glRight = left + (width / canvasWidth) * 2;
    const glTop = top;
    const glBottom = top - (height / canvasHeight) * 2;

    const sx = (glRight - glLeft) / 2;
    const sy = (glTop - glBottom) / 2;
    const tx = glLeft + sx;
    const ty = glBottom + sy;

    const xStep = 2 / (cols - 1);
    const yStep = 2 / (rows - 1);

    const visibleCells = [];
    const transparencyCache = new Map();

    const getTransparency = (x, y) => {
      const key = `${x},${y}`;
      if (transparencyCache.has(key)) return transparencyCache.get(key);
      const cellX = x / (cols - 1);
      const cellY = y / (rows - 1);
      const cellW = 1 / (cols - 1);
      const cellH = 1 / (rows - 1);
      const result = isAreaTransparent(cellX, cellY, cellW, cellH, image, width, height);
      transparencyCache.set(key, result);
      return result;
    };

    // 標記可見的格子
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        if (!getTransparency(x, y)) {
          visibleCells.push({ x, y });
        }
      }
    }

    const usedVertices = new Set();
    visibleCells.forEach(({ x, y }) => {
      usedVertices.add(y * cols + x);
      usedVertices.add(y * cols + x + 1);
      usedVertices.add((y + 1) * cols + x);
      usedVertices.add((y + 1) * cols + x + 1);
    });

    const vertexMapping = new Map();
    let newIndex = 0;
    const vertices = [];
    const indices = [];
    const linesIndices = [];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const originalIndex = y * cols + x;
        if (!usedVertices.has(originalIndex)) continue;

        vertexMapping.set(originalIndex, newIndex++);

        const standardX = -1 + x * xStep;
        const standardY = 1 - y * yStep;
        const glX = standardX * sx + tx;
        const glY = standardY * sy + ty;
        const texX = (standardX + 1) / 2;
        const texY = (1 - standardY) / 2;

        vertices.push(glX, glY, texX, texY);
      }
    }

    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        if (!getTransparency(x, y)) {
          const tl = y * cols + x;
          const tr = y * cols + x + 1;
          const bl = (y + 1) * cols + x;
          const br = (y + 1) * cols + x + 1;
          indices.push(
            vertexMapping.get(tl), vertexMapping.get(bl), vertexMapping.get(tr),
            vertexMapping.get(tr), vertexMapping.get(bl), vertexMapping.get(br)
          );
        }
      }
    }

    for (const originalIndex of usedVertices) {
      if (originalIndex % cols < cols - 1) {
        const right = originalIndex + 1;
        if (usedVertices.has(right)) {
          linesIndices.push(vertexMapping.get(originalIndex), vertexMapping.get(right));
        }
      }
      if (Math.floor(originalIndex / cols) < rows - 1) {
        const bottom = originalIndex + cols;
        if (usedVertices.has(bottom)) {
          linesIndices.push(vertexMapping.get(originalIndex), vertexMapping.get(bottom));
        }
      }
    }

    return { vertices, indices, linesIndices };
  }

  // 建立 WebGL buffer
  createWebGLBuffers(gl, vertices, indices, linesIndices) {
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    const eboLines = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(linesIndices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    return { vbo, ebo, eboLines };
  }

  // 原始入口，組合
  createLayerBuffers(
    gl,
    image,
    width,
    height,
    top,
    left,
    canvasWidth,
    canvasHeight,
    outputLayer,
    useGrid = true // <-- 
  ) {
    let vertices, indices, linesIndices;

    if (useGrid) {
      // 
      // 
      const gridData = this.generateGridVertices(
        image,
        width,
        height,
        top,
        left,
        canvasWidth,
        canvasHeight,
        10,
        10
      );
      vertices = gridData.vertices;
      indices = gridData.indices;
      linesIndices = gridData.linesIndices;
    } else {
      // 
      // 

      // 1. 
      const x_min = (left / canvasWidth) * 2 - 1;
      const x_max = ((left + width) / canvasWidth) * 2 - 1;
      const y_max = (top / canvasHeight) * -2 + 1; // Y
      const y_min = ((top + height) / canvasHeight) * -2 + 1;

      // 2. 
      //    v0 (top-left):     x_min, y_max, 0, 0
      //    v1 (top-right):    x_max, y_max, 1, 0
      //    v2 (bottom-right): x_max, y_min, 1, 1
      //    v3 (bottom-left):  x_min, y_min, 0, 1
      vertices = [
        x_min, y_max, 0, 0,
        x_max, y_max, 1, 0,
        x_max, y_min, 1, 1,
        x_min, y_min, 0, 1,
      ];

      // 3. 
      indices = [0, 3, 2, 0, 2, 1];

      // 4. 
      linesIndices = [0, 1, 1, 2, 2, 3, 3, 0];
    }

    // 
    const { vbo, ebo, eboLines } = this.createWebGLBuffers(
      gl,
      vertices,
      indices,
      linesIndices
    );

    outputLayer.vertices.value = [...vertices];
    outputLayer.poseVertices.value = [...vertices];
    outputLayer.transformParams = {
      left: -1,
      top: 1,
      width: canvasWidth,
      height: canvasHeight,
      canvasWidth,
      canvasHeight,
    };
    outputLayer.vbo = vbo;
    outputLayer.ebo = ebo;
    outputLayer.eboLines = eboLines;
    outputLayer.indices.value = indices;
    outputLayer.linesIndices.value = linesIndices;
    outputLayer.transformParams2 = {
      left: left,
      top: top,
      width: width,
      height: height,
      canvasWidth,
      canvasHeight,
    };
  }

  createLayerBuffersByInputLayers(gl, image, width, height, top, left, canvasWidth, canvasHeight, outputLayer, inputLayer) {

    console.log("checking I have vertices in input layer:", inputLayer.vertices.value.length);
    //use inputLayer's vertices to create buffers
    const vertices = [...inputLayer.vertices.value];
    const indices = [...inputLayer.indices.value];
    const linesIndices = [...inputLayer.linesIndices.value];


    const { vbo, ebo, eboLines } = this.createWebGLBuffers(gl, vertices, indices, linesIndices);

    outputLayer.vertices.value = [...vertices];
    outputLayer.poseVertices.value = [...vertices];
    outputLayer.transformParams = { left: -1, top: 1, width: canvasWidth, height: canvasHeight, canvasWidth, canvasHeight };
    outputLayer.vbo = vbo;
    outputLayer.ebo = ebo;
    outputLayer.eboLines = eboLines;
    outputLayer.indices.value = indices;
    outputLayer.linesIndices.value = linesIndices;
    outputLayer.transformParams2 = { left: left, top: top, width: width, height: height, canvasWidth, canvasHeight }
  }



  updateLayerVertices(gl, layer, options = {}) {
    const {
      update = [],
      add = [],
      delete: del = [],
      addEdge = [],      // 新增: [{v1: index1, v2: index2}, ...]
      deleteEdge = [],   // 新增: [{v1: index1, v2: index2}, ...]
    } = options;

    let vertices = [...layer.vertices.value];
    let indices = [...layer.indices.value];
    let linesIndices = [...layer.linesIndices.value];
    const vertexSize = 4; // [glX, glY, texX, texY]


    // 🔧 輔助函數: 建立邊的唯一key (小索引在前)
    const edgeKey = (v1, v2) => {
      const [a, b] = v1 < v2 ? [v1, v2] : [v2, v1];
      return `${a}-${b}`;
    };
    // 初始化 edges 結構 (如果不存在)
    if (!layer.edges) {
      layer.edges = new Set();

      // 從 linesIndices 建立 edges
      // linesIndices 格式: [v1, v2, v3, v4, ...] 每兩個索引代表一條邊
      for (let i = 0; i < linesIndices.length; i += 2) {
        const v1 = linesIndices[i];
        const v2 = linesIndices[i + 1];

        // 建立標準化的邊表示 (確保小索引在前,避免重複)
        layer.edges.add(edgeKey(v1, v2));
      }
    }

    // 初始化原始三角形記錄 (保留初始網格)
    if (!layer.originalTriangles) {
      layer.originalTriangles = new Set();
      for (let i = 0; i < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]].sort((a, b) => a - b).join('-');
        layer.originalTriangles.add(tri);
      }
    }

    // === 基本變形參數 (由 createLayerBuffers 設定) ===
    const { left, top, width, height, canvasWidth, canvasHeight } = layer.transformParams2;
    console.log(" layer transform params check : ", layer.transformParams);
    const sx = (width / canvasWidth);
    const sy = (height / canvasHeight);

    const toTexCoord = (glX, glY) => {
      // 反算標準化座標
      const standardX = (glX - (left + sx)) / sx;
      const standardY = (glY - (top - sy)) / sy;
      // 再轉回紋理座標
      const texX = (standardX + 1) / 2;
      const texY = (1 - standardY) / 2;
      return [texX, texY];
    };



    // 🔧 輔助函數: 尋找共享邊的三角形
    const findTriangles = (edges) => {
      const triangles = [];
      const edgeMap = new Map(); // vertex -> connected vertices

      // 建立鄰接表
      for (const key of edges) {
        const [v1, v2] = key.split('-').map(Number);
        if (!edgeMap.has(v1)) edgeMap.set(v1, new Set());
        if (!edgeMap.has(v2)) edgeMap.set(v2, new Set());
        edgeMap.get(v1).add(v2);
        edgeMap.get(v2).add(v1);
      }

      // 尋找三角形 (3個頂點兩兩相連)
      const visited = new Set();
      for (const [v1, neighbors1] of edgeMap) {
        for (const v2 of neighbors1) {
          if (v2 <= v1) continue; // 避免重複
          const neighbors2 = edgeMap.get(v2);
          for (const v3 of neighbors1) {
            if (v3 <= v2) continue;
            if (neighbors2.has(v3)) {
              const triKey = [v1, v2, v3].sort((a, b) => a - b).join('-');
              if (!visited.has(triKey)) {
                triangles.push([v1, v2, v3]);
                visited.add(triKey);
              }
            }
          }
        }
      }

      return triangles;
    };

    // 1️⃣ 修改頂點位置 + 同步 texcoord
    for (const { index, x, y } of update) {
      const i = index * vertexSize;
      if (i + 1 < vertices.length) {
        vertices[i] = x;
        vertices[i + 1] = y;
        const [texX, texY] = toTexCoord(x, y);
        vertices[i + 2] = texX;
        vertices[i + 3] = texY;
      }
    }

    // 2️⃣ 刪除頂點
    if (del.length > 0) {
      const sortedDel = [...del].sort((a, b) => b - a);

      // 刪除相關的邊
      const newEdges = new Set();
      for (const key of layer.edges) {
        const [v1, v2] = key.split('-').map(Number);
        if (!del.includes(v1) && !del.includes(v2)) {
          // 重新映射索引
          const newV1 = v1 - del.filter(d => d < v1).length;
          const newV2 = v2 - del.filter(d => d < v2).length;
          newEdges.add(edgeKey(newV1, newV2));
        }
      }
      layer.edges = newEdges;

      // 更新原始三角形
      const newOriginalTriangles = new Set();
      for (const triKey of layer.originalTriangles) {
        const [v1, v2, v3] = triKey.split('-').map(Number);
        if (!del.includes(v1) && !del.includes(v2) && !del.includes(v3)) {
          const newV1 = v1 - del.filter(d => d < v1).length;
          const newV2 = v2 - del.filter(d => d < v2).length;
          const newV3 = v3 - del.filter(d => d < v3).length;
          const newTriKey = [newV1, newV2, newV3].sort((a, b) => a - b).join('-');
          newOriginalTriangles.add(newTriKey);
        }
      }
      layer.originalTriangles = newOriginalTriangles;

      // 刪除頂點資料
      for (const index of sortedDel) {
        vertices.splice(index * vertexSize, vertexSize);
      }

      // 輔助函數：計算刪除後的新索引
      const getNewIndex = (oldIndex) => {
        // 計算在 oldIndex 之前有多少個頂點被刪除
        const shift = del.filter(d => d < oldIndex).length;
        return oldIndex - shift;
      };

      // 重建 indices (三角形索引)
      const newIndices = [];
      for (let i = 0; i < indices.length; i += 3) {
        const v1 = indices[i];
        const v2 = indices[i + 1];
        const v3 = indices[i + 2];

        // 檢查此三角形是否包含任何被刪除的頂點
        if (!del.includes(v1) && !del.includes(v2) && !del.includes(v3)) {
          // 如果沒有，則重新映射索引並保留此三角形
          newIndices.push(getNewIndex(v1), getNewIndex(v2), getNewIndex(v3));
        }
        // 如果包含，則此三角形被自動丟棄
      }
      indices = newIndices; // 更新為重建後的索引

      // 重建 linesIndices (線段索引)
      const newLinesIndices = [];
      for (let i = 0; i < linesIndices.length; i += 2) {
        const v1 = linesIndices[i];
        const v2 = linesIndices[i + 1];

        // 檢查此線段是否包含任何被刪除的頂點
        if (!del.includes(v1) && !del.includes(v2)) {
          // 如果沒有，則重新映射索引並保留此線段
          newLinesIndices.push(getNewIndex(v1), getNewIndex(v2));
        }
        // 如果包含，則此線段被自動丟棄
      }
      linesIndices = newLinesIndices; // 更新為重建後的線段索引
    }

    // 3️⃣ 新增頂點
    if (add.length > 0) {
      for (const { x, y, texX = null, texY = null } of add) {
        const [tx, ty] = texX != null ? [texX, texY] : toTexCoord(x, y);
        vertices.push(x, y, tx, ty);
      }
    }

    // 🆕 4️⃣ 新增邊
    if (addEdge.length > 0) {
      for (const { v1, v2 } of addEdge) {
        const vertexCount = vertices.length / vertexSize;
        if (v1 >= 0 && v1 < vertexCount && v2 >= 0 && v2 < vertexCount && v1 !== v2) {
          const key = edgeKey(v1, v2);

          // 🔧 檢查邊是否已經存在
          if (layer.edges.has(key)) {
            console.log(`⚠️ Edge ${key} already exists, skipping...`);
            continue;
          }

          layer.edges.add(key);
          // 更新線段索引
          linesIndices.push(v1, v2);
        }
      }
      // 檢查是否形成新的三角形
      const newTriangles = findTriangles(layer.edges);
      const existingTriangles = new Set([...layer.originalTriangles]);

      // 記錄現有的動態三角形
      for (let i = 0; i < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]].sort((a, b) => a - b).join('-');
        existingTriangles.add(tri);
      }

      // 新增三角形到索引
      for (const [v1, v2, v3] of newTriangles) {
        const triKey = [v1, v2, v3].sort((a, b) => a - b).join('-');
        if (!existingTriangles.has(triKey)) {
          indices.push(v1, v2, v3);
          console.log(`🔺 New triangle formed: ${v1}-${v2}-${v3}`);
        }
      }
    }

    // 🆕 5️⃣ 刪除邊
    // 🆕 5️⃣ 刪除邊
    if (deleteEdge.length > 0) {
      for (const { v1, v2 } of deleteEdge) {
        const key = edgeKey(v1, v2);
        layer.edges.delete(key);

        // 從線段索引中移除
        for (let i = 0; i < linesIndices.length; i += 2) {
          if ((linesIndices[i] === v1 && linesIndices[i + 1] === v2) ||
            (linesIndices[i] === v2 && linesIndices[i + 1] === v1)) {
            linesIndices.splice(i, 2);
            i -= 2; // 調整索引以繼續檢查
          }
        }
      }

      // 🔥 關鍵修正: 建立已刪除邊的集合
      const deletedEdges = new Set();
      for (const { v1, v2 } of deleteEdge) {
        deletedEdges.add(edgeKey(v1, v2));
      }

      // 檢查三角形是否包含已刪除的邊
      const triangleHasDeletedEdge = (v1, v2, v3) => {
        return deletedEdges.has(edgeKey(v1, v2)) ||
          deletedEdges.has(edgeKey(v2, v3)) ||
          deletedEdges.has(edgeKey(v1, v3));
      };

      const validDynamicTriangles = findTriangles(layer.edges);
      const allValidTriangles = new Set();

      // 🔑 永久更新 originalTriangles,移除包含已刪除邊的三角形
      const newOriginalTriangles = new Set();
      for (const triKey of layer.originalTriangles) {
        const [v1, v2, v3] = triKey.split('-').map(Number);
        if (!triangleHasDeletedEdge(v1, v2, v3)) {
          newOriginalTriangles.add(triKey);
          allValidTriangles.add(triKey);
        } else {
          console.log(`🗑️ Original triangle permanently removed: ${triKey}`);
        }
      }
      layer.originalTriangles = newOriginalTriangles; // 永久更新

      // 再加入有效的動態三角形
      for (const [v1, v2, v3] of validDynamicTriangles) {
        const triKey = [v1, v2, v3].sort((a, b) => a - b).join('-');
        allValidTriangles.add(triKey);
      }

      // 重建索引
      indices = [];
      for (const triKey of allValidTriangles) {
        const [v1, v2, v3] = triKey.split('-').map(Number);
        indices.push(v1, v2, v3);
      }


    }

    // 6️⃣ 更新 Buffer 資料
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.eboLines);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(linesIndices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    // 7️⃣ 更新 Layer 狀態
    layer.vertices.value = [...vertices];
    layer.poseVertices.value = [...vertices];
    layer.indices.value = indices;
    layer.linesIndices.value = linesIndices;

    console.log("✅ Vertices updated with refreshed texture mapping");
    console.log(`📊 Edges: ${layer.edges.size}, Triangles: ${indices.length / 3} (Original: ${layer.originalTriangles.size})`);
  }

}
export const setCurrentJobName = (jobName) => {
  currentJobName.value = jobName;
}
var time = 0;
export const render2 = (gl, program, colorProgram, skeletonProgram, renderLayer, selectedLayers, passes, jobName, beforePasses) => {
  if (currentJobName.value != jobName) {
    console.log("stop running ");
    return;
  }

  // console.log("selectedLayers.value, in render2: ", selectedLayers);
  time += 0.016;
  if (beforePasses)
    for (const pass of beforePasses) {
      pass(); // 每個 pass 內的參數已事先綁好
    }


  let res = render(gl, program, colorProgram, skeletonProgram, renderLayer, selectedLayers);

  if (res === false) {
    return;
  }
  // === 在所有圖層之後渲染格線/骨架 ===
  if (passes)
    for (const pass of passes) {
      pass(); // 每個 pass 內的參數已事先綁好
    }

  // 下一幀
  requestAnimationFrame(() =>
    render2(gl, program, colorProgram, skeletonProgram, renderLayer, selectedLayers, passes, jobName, beforePasses)
  );
};

//webgl function to render image
export const render = (gl, program, colorProgram, skeletonProgram, renderLayer, selectedLayers) => {

  if (gl.isContextLost()) {

    return false;
  }
  if (!program || !gl.isProgram(program)) {

    return false;
  }

  if (!selectedLayers)
    selectedLayers.value = [];
  // 啟用混合，但不要用深度測試（透明圖層會出問題）
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // 不要清掉畫布，不然會只剩最後一層
  // gl.clear(gl.COLOR_BUFFER_BIT);

  if (!texture.value || !Array.isArray(texture.value) || texture.value.length === 0) {
    console.log(" nothing here, stop loop");
    return false;
  }

  const textures = texture.value;

  gl.useProgram(program);

  // let layerIndices = [0, 1, 2, 3, 4];
  let layerIndices = selectedLayers.value;
  //console.log("layerIndices :  ",layerIndices)
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
    gl.drawElements(gl.TRIANGLES, layer.indices.value.length, gl.UNSIGNED_SHORT, 0);
    // gl.drawElements(gl.TRIANGLES, layer.indices.value.length, gl.UNSIGNED_SHORT, 0);
  }

};
export const makeRenderPass = (fn, ...args) => {
  return () => fn(...args);
};
export const renderMeshSkeleton = (gl, skeletonProgram, meshSkeleton, bonesInstance, mousePressed, activeTool) => {
  // 保存當前WebGL狀態
  let drawPoseBone = (activeTool.value === "bone-animate");

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

        if (drawPoseBone) {
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
    const transform = (drawPoseBone) ? bone.getGlobalPoseTransform() : bone.getGlobalTransform();

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
    const transform = (drawPoseBone) ? bone.getGlobalPoseTransform() : bone.getGlobalTransform();

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

//draw weight
export function renderWeightPaint(gl, program, selectedGroupName, layer, isWeightPaintMode) {
  //if (!program || glsInstance.getLayerSize() === 0) return;


  if (!isWeightPaintMode || !layer || !layer.vertexGroup || !layer.vertices.value) return;

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
  const indices = layer.indices.value;
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
export function renderGridOnly(gl, colorProgram, layers, layerSize, currentChosedLayerRef, selectedVertices) {

  if (!selectedVertices)
    selectedVertices.value = [];
  let currentChosedLayer = currentChosedLayerRef.value;

  var baseLayer = layers[currentChosedLayer];
  if (layerSize === 0) return;
  //console.log(" draw selectde vertices : ",selectedVertices);

  let layerIndex = currentChosedLayer;
  if (layerIndex >= layerSize)
    layerIndex = 0;

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
  if (baseLayer.eboLines && baseLayer.linesIndices.value && baseLayer.linesIndices.value.length > 0) {
    gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 1, 1, 0.3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, baseLayer.eboLines);
    gl.drawElements(gl.LINES, baseLayer.linesIndices.value.length, gl.UNSIGNED_SHORT, 0);
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
    if (selectedVertices.value && selectedVertices.value.length > 0) {
      if (pointSizeLocation !== null) {
        gl.uniform1f(pointSizeLocation, 6.0);
      }
      gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 0, 1, 0, 1);
      for (let idx of selectedVertices.value) {
        gl.drawArrays(gl.POINTS, idx, 1);
      }
    }
  }
}
export const layerToTexture = (gl, layer) => {
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
        height: image.height,       // 圖像高度
        src: image.src,                 // ✅ 加上來源
        name: url.split('/').pop()      // ✅ 可選：擷取檔名
      });
    };

    image.onerror = (error) => {
      console.error("Image loading failed:", error);
      reject(error);
    };

    image.src = url;
  });
};


export const clearTexture = (selectedLayers) => {
  // 清空之前的圖層
  glsInstance.clearAllLayer();

  selectedLayers.value = [];

}
export const pngLoadTexture = async (path) => {
  console.log("load png texture...");

  loadedImage.value = await loadTexture(gl.value, path);
  console.log(" loaded image data done! name: ", loadedImage.value.name);
  glsInstance.addLayer("QQ");
  return loadedImage.value;
}
export const pngRender = async () => {
  console.log("load first image...");

  texture.value = [];

  // 加载纹理
  let result = loadedImage.value;
  let layer = {
    imageData: result.data,
    width: result.width,
    height: result.height,
    top: 0,   // 預設居中顯示
    left: 0
  };

  texture.value.push(await layerToTexture(gl.value, layer));
  console.log(" hi texture in load png: ", texture.value.length);

  console.log("rebind gl layers...");

  let canvasHeight = texture.value[0].height;
  let canvasWidth = texture.value[0].width;
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
    glsInstance.createLayerBuffers(
      gl.value,
      texture.value[i].image,
      texture.value[i].width,
      texture.value[i].height,
      1,
      -1,
      canvasWidth,
      canvasHeight,
      glsInstance.refLayers[i],
      true
    );
  }
}

export const pngRenderAgain = async () => {
  console.log("load first image...");

  console.log("checking layer size : ", glsInstance.getLayerSize());
  texture.value = [];

  // 加载纹理
  let result = loadedImage.value;
  let layer = {
    imageData: result.data,
    width: result.width,
    height: result.height,
    top: 0,   // 預設居中顯示
    left: 0
  };

  texture.value.push(await layerToTexture(gl.value, layer));
  console.log(" hi texture in load png: ", texture.value.length);

  console.log("rebind gl layers...");

  let canvasHeight = texture.value[0].height;
  let canvasWidth = texture.value[0].width;
  for (let i = 0; i < texture.value.length; i++) {


    glsInstance.createLayerBuffersByInputLayers(
      gl.value,
      texture.value[i].image,
      texture.value[i].width,
      texture.value[i].height,
      1,
      -1,
      canvasWidth,
      canvasHeight,
      glsInstance.layers[i],
      glsInstance.layers[i]
    );
  }
}
export const bindGl = async (selectedLayers) => {


  // === 初始化图层缓冲区和顶点属性 ===
  for (let i = 0; i < texture.value.length; i++) {

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

    // 把圖層加到選取清單，讓 render2 能正常跑
    selectedLayers.value.push(i);
  }

  console.log(" sync layers checking size : ", glsInstance.layers.length);
  // 解绑所有缓冲区
  gl.value.bindBuffer(gl.value.ARRAY_BUFFER, null);
  gl.value.bindBuffer(gl.value.ELEMENT_ARRAY_BUFFER, null);

}
export const psdRender = async (selectedLayers, wholeImageHeight, wholeImageWidth) => {

  glsInstance.clearAllLayer();
  texture.value = [];

  let index = 0;
  let canvasHeight = wholeImageWidth;
  let canvasWidth = wholeImageHeight;

  for (const layerData of layerForTextureWebgl.value) {
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
      indicesLength: attachment.indices.value.length,
      visible: attachment.visible,
      coords: attachment.coords
    });

  }
  //syncLayers();

  // === 同步/初始化 ===
  for (let i = 0; i < texture.value.length; i++) {

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
  }
  //await bindGl(selectedLayers);
  console.log("WebGL initialization complete");

}

export const psdRenderAgain = async (selectedLayers, wholeImageHeight, wholeImageWidth) => {

  //glsInstance.clearAllLayer();
  texture.value = [];

  let canvasHeight = wholeImageWidth;
  let canvasWidth = wholeImageHeight;

  for (const layerData of layerForTextureWebgl.value) {
    // === 1. 建立 WebGL 紋理 ===
    const texInfo = await layerToTexture(gl.value, layerData);
    texture.value.push(texInfo);
  }
  //syncLayers();

  // === 同步/初始化 ===

  for (let i = 0; i < texture.value.length; i++) {

    const layer = glsInstance.layers[i];

    // === 使用 layer.attachment 的資料代替 layerData ===

    const att = layer.attachment;
    glsInstance.createLayerBuffersByInputLayers
      (
        gl.value,
        att.image, att.width, att.height,
        att.top, att.left,
        canvasWidth, canvasHeight,
        layer,
        layer
      );
  }
  //await bindGl(selectedLayers);
  console.log("WebGL initialization complete");

}

export const getClosestVertex = (xNDC, yNDC, vertices) => {
  let minDist = 0.05;
  let localSelectedVertex = -1;

  for (let i = 0; i < vertices.length; i += 4) {
    const dx = vertices[i] - xNDC;
    const dy = vertices[i + 1] - yNDC;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      localSelectedVertex = i / 4;
    }
  }
  //console.log("finally min dist : ", minDist);

  return localSelectedVertex;
}

//外部引用
// 📤 模組導出 (Exports)
export {
  gl,
  texture,
  program,
  colorProgram,
  skeletonProgram,
  weightPaintProgram,
  skinnedProgram,
  layerForTextureWebgl,

  configSettings,
  transparentCells,
  isAreaTransparent
};

const glsInstance = new gls();

export default glsInstance;