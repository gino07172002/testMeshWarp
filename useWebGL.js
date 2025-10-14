// useWebGL.js
const { ref, reactive } = Vue;

import {
  // initBone,

} from './useBone.js';


import {
  Mesh2D,
  Bone
} from './mesh.js';
// 📦 全局狀態區 (State)
const gl = ref(null);                    // WebGL 上下文
const texture = ref(null);               // 紋理
const program = ref(null);               // 主著色器程序
const colorProgram = ref(null);          // 顏色著色器程序
const skeletonProgram = ref(null);       // 骨骼著色器程序
const weightPaintProgram = ref(null);
const skinnedProgram = ref(null);



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
    vertexGroup
  };
}


class gls {

  constructor() {
    // 存储所有图层的数组 (响应式)
    this.layers = [];

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
      // 如果有自訂函數，直接使用它產生頂點資料


      /*
      //customGrid example
      const customGrid = ({ rows, cols }) => {
  const vertices = [
    // 自訂頂點位置和紋理座標
  ];
  const indices = [
    // 自訂三角形索引
  ];
  const linesIndices = [
    // 自訂線索引
  ];
  return { vertices, indices, linesIndices };
};
      */
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
  createLayerBuffers(gl, image, width, height, top, left, canvasWidth, canvasHeight, outputLayer, customVertexFunc = null) {
    const { vertices, indices, linesIndices } = this.generateGridVertices(
      image, width, height, top, left, canvasWidth, canvasHeight, 10, 10, customVertexFunc
    );

    const { vbo, ebo, eboLines } = this.createWebGLBuffers(gl, vertices, indices, linesIndices);

    outputLayer.vertices.value = [...vertices];
    outputLayer.poseVertices.value = [...vertices];
    outputLayer.transformParams = { left: -1, top: 1, width: canvasWidth, height: canvasHeight, canvasWidth, canvasHeight };
    outputLayer.vbo = vbo;
    outputLayer.ebo = ebo;
    outputLayer.eboLines = eboLines;
    outputLayer.indices = indices;
    outputLayer.linesIndices = linesIndices;
  }

  // Modified createBuffers to populate transparentCells





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


  configSettings,
  transparentCells,
  isAreaTransparent
};

export default new gls();