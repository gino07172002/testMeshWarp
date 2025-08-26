// useWebGL.js
const { ref, reactive } = Vue;

import {
  // initBone,
  skeletonVertices,
  originalSkeletonVertices,
  vertexInfluences,
} from './useBone.js';


import
{
  Mesh2D,
  Bone
}from './mesh.js';
// 📦 全局狀態區 (State)
const gl = ref(null);                    // WebGL 上下文
const texture = ref(null);               // 紋理
const program = ref(null);               // 主著色器程序
const colorProgram = ref(null);          // 顏色著色器程序
const skeletonProgram = ref(null);       // 骨骼著色器程序


// Mesh-related reactive variables
const vertices = ref([]);                // 當前頂點數據
const originalVertices = ref([]);        // 原始頂點數據
const indices = ref([]);                 // 三角形索引
const linesIndices = ref([]);            // 線條索引



const gridCells = ref([]);
const transparentCells = ref(new Set()); // Store transparent cells

// Other state variables
//const imageData = ref(null);
//const imageWidth = ref(0);
//const imageHeight = ref(0);

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


//try make a new gls image layer contains vertice, texure infos
export class ImageLayerGls {
  constructor() {
    this.image = ref(null);
    this.name = ref('');
    this.visible = ref(true);
    this.vertices = ref([]);
    this.originalVertices = ref([]);
    this.indices = ref([]);
    this.linesIndices = ref([]);
    this.transparentCells = ref(new Set()); // Store transparent cells
    this.gridCellsLayer = ref([]);

    //each layer has its own buffers
    this.vbo = ref(null); // 頂點緩衝區
    this.ebo = ref(null); // 元素緩衝區（三角形）
    this.eboLines = ref(null); // 元素緩衝區（線條）
  }

  loadImage(url) {
    this.image.value = url;
    console.log(`image layer gls Image loaded: ${url}`);
   // this.createBuffers(gl, imageData, imageWidth, imageHeight);
    console.log(" image layer gls create buffer done ... ");
  }

  createBuffers( gl,image, width, height) {
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

        //const isTransparent = isAreaTransparent(cellX, cellY, cellW, cellH, imageData, imageWidth, imageHeight);
        const isTransparent = isAreaTransparent(cellX, cellY, cellW, cellH, image, width, height);

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


        if (!isAreaTransparent(cellX, cellY, cellW, cellH, image, width, height))
           {
          const topLeft = y * cols + x;
          const topRight = y * cols + x + 1;
          const bottomLeft = (y + 1) * cols + x;
          const bottomRight = (y + 1) * cols + x + 1;
          const newTopLeft = vertexMapping.get(topLeft);
          const newTopRight = vertexMapping.get(topRight);
          const newBottomLeft = vertexMapping.get(bottomLeft);
          const newBottomRight = vertexMapping.get(bottomRight);
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


        this.vbo.value = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo.value);  
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);
        
       this.ebo.value = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,  this.ebo.value);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);

       this.eboLines.value = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,  this.eboLines.value);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);

      

      
    };
   

  updateMesh()
  {
    /*
      for (let i = 0; i < this.vbo.value.length; i++) {
      gl.value.bindBuffer(gl.value.ARRAY_BUFFER, this.vbo.value[i]);
      gl.value.bufferData(gl.value.ARRAY_BUFFER, new Float32Array(vertices.value), gl.value.DYNAMIC_DRAW);
    }
      */
  }

}




export function useImageLayer() {
  const image = ref(null);
  const name = ref('');
  const visible = ref(true);
  const vertices = ref([]);                // 當前頂點數據
  const originalVertices = ref([]);        // 原始頂點數據
  const indices = ref([]);                 // 三角形索引
  const linesIndices = ref([]);
  const texture = ref(null); // 紋理
  const vbo = ref(null); // 頂點緩衝區
  const ebo = ref(null); // 元素緩衝區（三角形）
  const eboLines = ref(null); // 元素緩衝區（線條）

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
    originalVertices,
    indices,
    linesIndices
  };
}


class gls {

  constructor() {
    // 存储所有图层的数组 (响应式)
    this.layers = [];

    // 按名称索引的图层映射
    this.layerMap = {};

    this.addLayer("haha");
    const tempLayer = this.getLayer("haha");
    console.log("test get layer:", {
      name: tempLayer.name.value,
      visible: tempLayer.visible.value,
      image: tempLayer.image.value
    });
   

  };

  addLayer(layerName) {
    const newLayer = useImageLayer();
    newLayer.name.value = layerName;

    this.layers.push(newLayer);
    this.layerMap[layerName] = newLayer;

    console.log(`Layer added: ${layerName}`);
    return newLayer;
  };

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

  resetMeshToOriginal() {
    console.log(" hi reset mesh to original ... ");

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

  clearAllLayerBuffers() {
    

  }
  createLayerBuffers(gl, image, width, height) {

    this.createBuffers2(gl, image, width, height);
   

  }
createBuffers2(gl, image, width, height) {
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

        //const isTransparent = isAreaTransparent(cellX, cellY, cellW, cellH, imageData, imageWidth, imageHeight);
        const isTransparent = isAreaTransparent(cellX, cellY, cellW, cellH, image, width, height);

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


        if (!isAreaTransparent(cellX, cellY, cellW, cellH, image, width, height))
           {
          const topLeft = y * cols + x;
          const topRight = y * cols + x + 1;
          const bottomLeft = (y + 1) * cols + x;
          const bottomRight = (y + 1) * cols + x + 1;
          const newTopLeft = vertexMapping.get(topLeft);
          const newTopRight = vertexMapping.get(topRight);
          const newBottomLeft = vertexMapping.get(bottomLeft);
          const newBottomRight = vertexMapping.get(bottomRight);
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

    for (let i = 0; i < this.getLayerSize(); i++) {
      const layer = this.layers[i];
      layer.vertices.value= currentVertices;
      layer.originalVertices.value = [...currentVertices];
      if (layer) {
        layer.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);  
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);
        
        layer.ebo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);

        layer.eboLines = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.eboLines);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);

      

      } else {
        console.warn(`Layer ${i} does not exist.`);

      }
     
        
    }  
   
  };


  // Modified createBuffers to populate transparentCells



  updateMeshForSkeletonPose() {

   console.log(" gls get size : ",this.getLayerSize());

    console.log("updateMeshForSkeletonPose called");
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

  vertices,
  originalVertices,
  indices,
  linesIndices,
  configSettings,
  //imageData,
  //imageWidth,
  //imageHeight,
  gridCells,
  transparentCells,

  isAreaTransparent
};

export default new gls();