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



export function useImageLayer() {
  const image = ref(null);
  const name = ref('');
  const visible = ref(true);
  const vertices = ref([]);                // 當前頂點數據
  const poseVertices = ref([]);        // vertex after bone pose applied
  const indices = ref([]);                 // 三角形索引
  const linesIndices = ref([]);
  const vertexGroup = ref([
    { name: "group1" },
    { name: "group2" },
    { name: "group3" }
  ]);
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
    const newLayer = useImageLayer();
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




  createLayerBuffers(gl, image, width, height, top, left, canvasWidth, canvasHeight, outputLayer) {
    console.log("checking inside create buffer : width:", width, " height:", height,
      " top:", top, " left:", left, " canvasWidth:", canvasWidth, " canvasHeight:", canvasHeight);

    const rows = 10, cols = 10;

    // === 計算座標轉換參數 ===
    // 參考您的渲染算法
    const glLeft = left;
    const glRight = left + (width / canvasWidth) * 2;
    const glTop = top;
    const glBottom = top - (height / canvasHeight) * 2;

    const sx = (glRight - glLeft) / 2;
    const sy = (glTop - glBottom) / 2;
    const tx = glLeft + sx;
    const ty = glBottom + sy;

    // 網格在標準化座標系統中的步長
    const xStep = 2 / (cols - 1);
    const yStep = 2 / (rows - 1);

    // 每次呼叫前都重新初始化暫存容器
    const visibleCells = [];
    const gridCellsTemp = [];
    const transparentSet = new Set();

    // cache cell transparency 避免重複運算
    const transparencyCache = new Map();

    const getTransparency = (x, y) => {
      const key = `${x},${y}`;
      if (transparencyCache.has(key)) return transparencyCache.get(key);

      // 計算在圖層內的相對位置
      const cellX = x / (cols - 1);
      const cellY = y / (rows - 1);
      const cellW = 1 / (cols - 1);
      const cellH = 1 / (rows - 1);

      const result = isAreaTransparent(cellX, cellY, cellW, cellH, image, width, height);
      //  const result = false; // for test
      transparencyCache.set(key, result);
      return result;
    };

    // 掃描格子
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const cellIndex = y * (cols - 1) + x;
        const topLeft = y * cols + x;
        const topRight = y * cols + x + 1;
        const bottomLeft = (y + 1) * cols + x;
        const bottomRight = (y + 1) * cols + x + 1;

        const isTransparent = getTransparency(x, y);

        if (!isTransparent) {
          visibleCells.push({ x, y });
        } else {
          transparentSet.add(cellIndex);
          gridCellsTemp.push({
            vertices: [topLeft, topRight, bottomRight, bottomLeft],
            isTransparent
          });
        }
      }
    }

    // 記錄用到的頂點
    const usedVertices = new Set();
    visibleCells.forEach(({ x, y }) => {
      usedVertices.add(y * cols + x);
      usedVertices.add(y * cols + x + 1);
      usedVertices.add((y + 1) * cols + x);
      usedVertices.add((y + 1) * cols + x + 1);
    });

    // 建立頂點資料
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

          // === 應用座標轉換到網格頂點 ===
          // 先計算標準化座標 (-1 到 1)
          const standardX = -1 + x * xStep;
          const standardY = 1 - y * yStep;

          // 應用變換矩陣到網格位置
          const glX = standardX * sx + tx;
          const glY = standardY * sy + ty;
          // const glX = standardX; // 保持 -1 ~ 1
          //const glY = standardY;

          // 紋理座標使用原始標準化座標 (底圖保持原樣，避免二次變換)
          const texX = (standardX + 1) / 2;  // 將 -1~1 轉換為 0~1
          const texY = (1 - standardY) / 2;  // 將 -1~1 轉換為 0~1，並翻轉Y軸

          currentVertices.push(glX, glY, texX, texY);
        }
      }
    }

    // 建立三角形索引
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        if (!getTransparency(x, y)) {
          const topLeft = y * cols + x;
          const topRight = y * cols + x + 1;
          const bottomLeft = (y + 1) * cols + x;
          const bottomRight = (y + 1) * cols + x + 1;
          currentIndices.push(
            vertexMapping.get(topLeft), vertexMapping.get(bottomLeft), vertexMapping.get(topRight),
            vertexMapping.get(topRight), vertexMapping.get(bottomLeft), vertexMapping.get(bottomRight)
          );
        }
      }
    }

    // 建立線索引
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


    outputLayer.vertices.value = [...currentVertices];
    outputLayer.poseVertices.value = [...currentVertices];
    //  outputLayer.transformParams = { left, top, width, height, canvasWidth, canvasHeight };
    outputLayer.transformParams = { left: -1, top: 1, width: canvasWidth, height: canvasHeight, canvasWidth, canvasHeight };

    outputLayer.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, outputLayer.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null); // 解綁，避免污染全域狀態

    outputLayer.ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, outputLayer.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    outputLayer.eboLines = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, outputLayer.eboLines);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    outputLayer.indices = currentIndices;
    outputLayer.linesIndices = currentLinesIndices;
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