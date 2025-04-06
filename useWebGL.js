// useWebGL.js
const { ref, reactive } = Vue;

// 📦 全局狀態區 (State)
const gl = ref(null);                    // WebGL 上下文
const texture = ref(null);               // 紋理
const program = ref(null);               // 主著色器程序
const colorProgram = ref(null);          // 顏色著色器程序
const skeletonProgram = ref(null);       // 骨骼著色器程序
const vbo = ref(null);                   // 頂點緩衝區
const ebo = ref(null);                   // 元素緩衝區（三角形）
const eboLines = ref(null);              // 元素緩衝區（線條）
const vertices = ref([]);                // 當前頂點數據
const originalVertices = ref([]);        // 原始頂點數據
const indices = ref([]);                 // 三角形索引
const linesIndices = ref([]);            // 線條索引
const configSettings = reactive({        // 響應式配置
  imageSrc: './png3.png',                // 圖片來源
  rows: 10,                              // 網格行數
  cols: 10                               // 網格列數
});
const externalDependencies = ref(null);  // 外部依賴容器

//外部引用
import { skeletonVertices } from './useBone.js';
function compileShader (gl, source, type){
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compilation failed:', gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
};
function createProgram(gl, vsSource, fsSource) {
  const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link failed:', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
};

// 🔌 外部依賴注入 (Dependency Injection)
function initWebGL({ canvas, container, imageData, imageWidth, imageHeight, shaders }) {
  externalDependencies.value = {
    canvas,
    container,
    imageData,
    imageWidth,
    imageHeight,
    shaders
  };

  // 初始化 WebGL 上下文
  gl.value = canvas.getContext('webgl');
  if (!gl.value) {
    console.error('無法初始化 WebGL');
    return;
  }

  // 創建著色器程序
  program.value = createProgram(gl.value, shaders.vertex, shaders.fragment);
  colorProgram.value = createProgram(gl.value, shaders.colorVertex, shaders.colorFragment);
  skeletonProgram.value = createProgram(gl.value, shaders.skeletonVertex, shaders.skeletonFragment);

  // 加載紋理並創建緩衝區
  loadTexture(gl.value, configSettings.imageSrc, imageData, imageWidth, imageHeight)
    .then((loadedTexture) => {
      texture.value = loadedTexture;
      createBuffers(gl.value);
      setupCanvasEvents(canvas, gl.value, container);
      render(gl.value, program.value, colorProgram.value, skeletonProgram.value);
    })
    .catch((error) => console.error('紋理加載失敗:', error));
}

// ⚙️ 核心功能層 (Core Functions)
function createBuffers(gl) {
  const { imageData, imageWidth, imageHeight } = externalDependencies.value;
  const { rows, cols } = configSettings;
  const xStep = 2.0 / (cols - 1);
  const yStep = 2.0 / (rows - 1);

  const visibleCells = [];
  const currentVertices = [];
  const currentIndices = [];
  const currentLinesIndices = [];

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const cellX = x / (cols - 1);
      const cellY = y / (rows - 1);
      const cellW = 1 / (cols - 1);
      const cellH = 1 / (rows - 1);
      const isTransparent = isAreaTransparent(cellX, cellY, cellW, cellH, imageData, imageWidth, imageHeight);
      if (!isTransparent) {
        visibleCells.push({ x, y });
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
        currentLinesIndices.push(vertexMapping.get(originalIndex1), vertexMapping.get(originalIndex2));
      }
    }
    if (Math.floor(originalIndex1 / cols) < rows - 1) {
      const originalIndex2 = originalIndex1 + cols;
      if (usedVertices.has(originalIndex2)) {
        currentLinesIndices.push(vertexMapping.get(originalIndex1), vertexMapping.get(originalIndex2));
      }
    }
  }

  vertices.value = currentVertices;
  originalVertices.value = [...currentVertices];
  indices.value = currentIndices;
  linesIndices.value = currentLinesIndices;

  vbo.value = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo.value);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currentVertices), gl.DYNAMIC_DRAW);

  ebo.value = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo.value);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentIndices), gl.STATIC_DRAW);

  eboLines.value = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines.value);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(currentLinesIndices), gl.STATIC_DRAW);
}

function createSkeletonBuffers(gl) {
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
}

function render(gl, program, colorProgram, skeletonProgram) {
  //console.log("hi render ...");
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
    const { skeletonVbo, skeletonEbo, skeletonVerticesArray, skeletonIndicesArray } = createSkeletonBuffers(gl);

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
}

// 🧰 工具方法層 (Utilities)
function setupCanvasEvents(canvas, gl, container) {
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
        // 骨骼創建邏輯保留在 useBone.js 中，這裡只觸發事件
        isDragging = true;
      } else if (activeTool.value === 'bone-animate') {
        // 骨骼動畫邏輯依賴 useBone.js，這裡處理基本拖動
        isDragging = true;
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
    }
  };

  const handleMouseUp = () => {
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
}
// ======= Texture Loading Functions =======
function loadTexture(gl, url, imageData, imageWidth, imageHeight){
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
// Helper to check if an area is fully transparent
function isAreaTransparent (x, y, w, h, imageData, imageWidth, imageHeight) {
  if (!imageData.value) return false;

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
  initWebGL,
  createBuffers,
  createSkeletonBuffers,
  render,
  compileShader,
  loadTexture,
  isAreaTransparent 
};