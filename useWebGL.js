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

//webgl function to render image
export const render = (gl, program, colorProgram, skeletonProgram, renderLayer, selectedLayers) => {


  // 啟用混合，但不要用深度測試（透明圖層會出問題）
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // 不要清掉畫布，不然會只剩最後一層
  // gl.clear(gl.COLOR_BUFFER_BIT);


  if (!texture.value || !Array.isArray(texture.value) || texture.value.length === 0) {
    console.log(" nothing here, stop loop");
    return;
  }

  const textures = texture.value;

  gl.useProgram(program);


  // let layerIndices = [0, 1, 2, 3, 4];
  let layerIndices = selectedLayers;
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

};

export const renderMeshSkeleton = (gl, skeletonProgram, meshSkeleton, bonesInstance, mousePressed, drawPoseBone) => {
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
export function renderWeightPaint(gl, program, selectedGroupName, layer) {
  //if (!program || glsInstance.getLayerSize() === 0) return;


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
export function renderGridOnly(gl, colorProgram, baseLayer, layerSize, currentChosedLayer, selectedVertices = []) {

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