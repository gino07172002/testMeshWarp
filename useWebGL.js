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
  clearBones,
  saveBones,
  readBones
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


// Helper to check if an area is fully transparent
const isAreaTransparent = (x, y, w, h, imageData, imageWidth, imageHeight) => {
  if (!imageData.value)
    {
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

class gls
{
  compileShader(gl, source, type){
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
  
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compilation failed:', gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };

  createProgram (gl, vsSource, fsSource) {
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

resetMeshToOriginal(){
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

createSkeletonBuffers(gl){
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
distanceFromPointToSegment(px, py, ax, ay, bx, by){
  const dx = bx - ax;
  const dy = by - ay;
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const nearestX = ax + clampedT * dx;
  const nearestY = ay + clampedT * dy;
  return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
};
 // Modified computeVertexInfluences with transparency check
 computeVertexInfluences(){
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

isLineThroughTransparent(x1, y1, x2, y2, cols, rows){
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
   createBuffers (gl){
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

    updateMeshForSkeletonPose() {
      //console.log("let's update mesh ... ");
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
    
       
        setVertexBoneWeight(vertexIndex, boneIndex, newWeight)  {
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