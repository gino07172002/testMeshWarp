// useWebGL.js
const { ref, reactive } = Vue;

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
} from './useBone.js';

// 📦 全局狀態區 (State)
const gl = ref(null);                    // WebGL 上下文
const texture = ref(null);               // 紋理
const program = ref(null);               // 主著色器程序
const colorProgram = ref(null);          // 顏色著色器程序
const skeletonProgram = ref(null);       // 骨骼著色器程序
const vbo = ref(null);                   // 頂點緩衝區
const ebo = ref(null);                   // 元素緩衝區（三角形）
const eboLines = ref(null);              // 元素緩衝區（線條）

const vbo2 = ref([]);                   // 頂點緩衝區
const ebo2 = ref([]);                   // 元素緩衝區（三角形）
const eboLines2 = ref([]);  

// Mesh-related reactive variables
const vertices = ref([]);                // 當前頂點數據
const originalVertices = ref([]);        // 原始頂點數據
const indices = ref([]);                 // 三角形索引
const linesIndices = ref([]);            // 線條索引
const gridCells = ref([]);
const transparentCells = ref(new Set()); // Store transparent cells

// Other state variables
const imageData = ref(null);
const imageWidth = ref(0);
const imageHeight = ref(0);

const configSettings = reactive({        // 響應式配置
  imageSrc: './png3.png',                // 圖片來源
  rows: 10,                              // 網格行數
  cols: 10                               // 網格列數
});
const externalDependencies = ref(null);  // 外部依賴容器


//for multi-layer use
const layerBuffers = ref(new Map()); // 儲存每個圖層的緩衝區
const layerData = ref(new Map()); // 儲存每個圖層的數據


// Helper to check if an area is fully transparent
const isAreaTransparent = (x, y, w, h, imageData, imageWidth, imageHeight) => {
  if (!imageData.value) {
    console.log("no image data...");
    return false;
  }

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

class gls {
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

  resetMeshToOriginal() {
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

  createSkeletonBuffers(gl) {
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
  distanceFromPointToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    const clampedT = Math.max(0, Math.min(1, t));
    const nearestX = ax + clampedT * dx;
    const nearestY = ay + clampedT * dy;
    return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
  };
  // Modified computeVertexInfluences with transparency check
  computeVertexInfluences() {
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
        const headThroughTransparent = this.isLineThroughTransparent(vertexX, vertexY, boneStartX, boneStartY, cols, rows);
        const tailThroughTransparent = this.isLineThroughTransparent(vertexX, vertexY, boneEndX, boneEndY, cols, rows);

        if (headThroughTransparent && tailThroughTransparent) {
          // Skip this bone if both lines pass through transparent areas
          continue;
        }

        const distanceToBone = this.distanceFromPointToSegment(
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

  isLineThroughTransparent(x1, y1, x2, y2, cols, rows) {
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
  // Modified createBuffers to populate transparentCells
  createBuffers(gl) {
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


    // clear buffer first
    if (vbo.value) gl.deleteBuffer(vbo.value);
    if (ebo.value) gl.deleteBuffer(ebo.value);
    if (eboLines.value) gl.deleteBuffer(eboLines.value);

    console.log(" init vbo ? ");
    vbo.value = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);

    ebo.value = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo.value);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);

    eboLines.value = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines.value);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);
   

    //test for multi layer
    for(let i=0;i<3;i++)
    {
      console.log(" somehow 3 layers... ");
      vbo2.value.push(gl.createBuffer());
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo2.value[i]);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);

      ebo2.value.push(gl.createBuffer());
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo2.value[i]);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);
  
      eboLines2.value.push(gl.createBuffer());
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines2.value[i]);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);
   
    }


  };

  testAgain(gl, currentVertices, currentIndices, currentLinesIndices) {
    console.log(" init vbo ? ");
    if (vbo.value) gl.deleteBuffer(vbo.value);
    if (ebo.value) gl.deleteBuffer(ebo.value);
    if (eboLines.value) gl.deleteBuffer(eboLines.value);

    vbo.value = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);

    ebo.value = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo.value);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);

    eboLines.value = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines.value);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);
    this.initMultiLayerBuffer(gl, currentVertices, currentIndices, currentLinesIndices, 1) ;
  };



  // for mult-layers
  initMultiLayerBuffer(gl, currentVertices, currentIndices, currentLinesIndices, layerCount) {
    const vbo = { value: [] };
    const ebo = { value: [] };
    const eboLines = { value: [] };

    for (let i = 0; i < layerCount; i++) {
      // 建立 VBO
      const vboItem = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vboItem);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);
      vbo.value.push(vboItem);

      // 建立 EBO (Triangles)
      const eboItem = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboItem);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array( currentIndices), gl.STATIC_DRAW);
      ebo.value.push(eboItem);

      // 建立 EBO (Lines)
      const eboLinesItem = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLinesItem);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);
      eboLines.value.push(eboLinesItem);
    }

    return { vbo, ebo, eboLines };
  }

  updateMeshForSkeletonPose() {
    const numVertices = vertices.value.length / 4;

    for (let i = 0; i < numVertices; i++) {
      const influences = vertexInfluences.value[i];
      const vertexOffset = i * 4;

      // 如果沒有骨骼影響，直接使用原始頂點
      if (influences.length === 0) {
        vertices.value[vertexOffset] = originalVertices.value[vertexOffset];
        vertices.value[vertexOffset + 1] = originalVertices.value[vertexOffset + 1];
        continue;
      }

      const originalX = originalVertices.value[vertexOffset];
      const originalY = originalVertices.value[vertexOffset + 1];
      let skinnedX = 0;
      let skinnedY = 0;

      // 對每個影響此頂點的骨骼進行變形計算
      influences.forEach(({ boneIndex, weight }) => {
        const boneOffset = boneIndex * 4;

        // 獲取原始和當前骨骼位置
        const origHead = {
          x: originalSkeletonVertices.value[boneOffset],
          y: originalSkeletonVertices.value[boneOffset + 1]
        };
        const origTail = {
          x: originalSkeletonVertices.value[boneOffset + 2],
          y: originalSkeletonVertices.value[boneOffset + 3]
        };
        const currHead = {
          x: skeletonVertices.value[boneOffset],
          y: skeletonVertices.value[boneOffset + 1]
        };
        const currTail = {
          x: skeletonVertices.value[boneOffset + 2],
          y: skeletonVertices.value[boneOffset + 3]
        };

        // 計算骨骼方向和長度
        const origDir = { x: origTail.x - origHead.x, y: origTail.y - origHead.y };
        const currDir = { x: currTail.x - currHead.x, y: currTail.y - currHead.y };

        const origLength = Math.sqrt(origDir.x ** 2 + origDir.y ** 2);
        const currLength = Math.sqrt(currDir.x ** 2 + currDir.y ** 2);
        const scale = currLength / origLength;

        // 計算旋轉角度
        const rotationAngle = Math.atan2(currDir.y, currDir.x) - Math.atan2(origDir.y, origDir.x);

        // 將頂點轉換到骨骼本地坐標系
        const localX = originalX - origHead.x;
        const localY = originalY - origHead.y;

        // 應用縮放和旋轉變換
        const cos = Math.cos(rotationAngle);
        const sin = Math.sin(rotationAngle);

        const transformedX = (localX * scale) * cos - (localY * scale) * sin;
        const transformedY = (localX * scale) * sin + (localY * scale) * cos;

        // 轉換回世界坐標系
        const worldX = transformedX + currHead.x;
        const worldY = transformedY + currHead.y;

        // 根據權重累加影響
        skinnedX += worldX * weight;
        skinnedY += worldY * weight;
      });

      // 更新頂點位置
      vertices.value[vertexOffset] = skinnedX;
      vertices.value[vertexOffset + 1] = skinnedY;
    }

    // 更新GPU緩衝區
    gl.value.bindBuffer(gl.value.ARRAY_BUFFER, vbo.value);
    gl.value.bufferData(gl.value.ARRAY_BUFFER, new Float32Array(vertices.value), gl.value.DYNAMIC_DRAW);
  };


  setVertexBoneWeight(vertexIndex, boneIndex, newWeight) {
    const influences = vertexInfluences.value[vertexIndex];

    if (influences) {
      const influence = influences.find(inf => inf.boneIndex === boneIndex);
      if (influence) {
        influence.weight = newWeight;
        const totalWeight = influences.reduce((sum, inf) => sum + inf.weight, 0);
        if (totalWeight > 0) {
          influences.forEach(inf => inf.weight /= totalWeight);
        }
        this.updateMeshForSkeletonPose();
      }
    }
  };
}
//外部引用
// 📤 模組導出 (Exports)
export {
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
  configSettings,
  imageData,
  imageWidth,
  imageHeight,
  gridCells,
  transparentCells,

  isAreaTransparent
};

export default new gls();