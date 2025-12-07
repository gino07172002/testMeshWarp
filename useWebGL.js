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
import { wholeImageHeight, wholeImageWidth } from './globalVars.js';

// 📦 Global State
const gl = ref(null);
const texture = ref(null);
const program = ref(null);
const colorProgram = ref(null);
const skeletonProgram = ref(null);
const weightPaintProgram = ref(null);
const skinnedProgram = ref(null);
const layerForTextureWebgl = ref([]);
const currentJobName = ref(null);
var debugMousePos;
var boundaryWorldVerts = [];
export const loadedImage = ref(null);

// ==========================================
// 🎨 Shader Sources
// ==========================================
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
    uniform mat4 uTransform;
    void main() {
      gl_Position = uTransform * vec4(aPosition, 0.0, 1.0);
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
    attribute float aWeight; 
    varying float vWeight;   
    uniform mat4 uTransform;
    uniform float uPointSize;

    void main() {
      gl_Position = uTransform * vec4(aPosition, 0.0, 1.0);
      gl_PointSize = uPointSize; 
      vWeight = aWeight;         
    }
  `,
  weightPaintFragment: `
    precision mediump float;
    varying float vWeight; 
    uniform float uOpacity;

    vec3 heatMap(float v) {
        float value = clamp(v, 0.0, 1.0);
        vec3 blue = vec3(0.0, 0.0, 1.0);
        vec3 cyan = vec3(0.0, 1.0, 1.0);
        vec3 green = vec3(0.0, 1.0, 0.0);
        vec3 yellow = vec3(1.0, 1.0, 0.0);
        vec3 red = vec3(1.0, 0.0, 0.0);

        if (value < 0.25) return mix(blue, cyan, value * 4.0);
        if (value < 0.5)  return mix(cyan, green, (value - 0.25) * 4.0);
        if (value < 0.75) return mix(green, yellow, (value - 0.5) * 4.0);
        return mix(yellow, red, (value - 0.75) * 4.0);
    }

    void main() {
      vec3 color = heatMap(vWeight);
      gl_FragColor = vec4(color, 0.7); 
    }
  `,
  skinnedVertex: `
 attribute vec2 aPosition;
  attribute vec2 aTexCoord;

  attribute vec4 aBoneIndices;   
  attribute vec4 aBoneWeights;

  uniform mat4 uTransform;
  uniform sampler2D uBoneTexture; 
  uniform float uBoneTextureSize; 

  varying vec2 vTexCoord;

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

const transparentCells = ref(new Set());

const configSettings = reactive({
  imageSrc: './png3.png',
  rows: 10,
  cols: 10
});

// Helper to check if an area is fully transparent
const isAreaTransparent = (x, y, w, h, imageData, imageWidth, imageHeight) => {
  if (!imageData) return false;

  const width = imageWidth;
  const height = imageHeight;
  const startX = Math.floor(x * width);
  const startY = Math.floor(y * height);
  const endX = Math.min(Math.ceil((x + w) * width), width);
  const endY = Math.min(Math.ceil((y + h) * height), height);

  for (let py = startY; py < endY; py++) {
    for (let px = startX; px < endX; px++) {
      const pixelIndex = (py * width + px) * 4 + 3;
      if (imageData[pixelIndex] > 0) return false;
    }
  }
  return true;
};

// ==========================================
// 🧠 Transform Manager
// ==========================================
class TransformManager {
  static getLayerParams(layer) {
    return layer.poseTransformParams || layer.transformParams;
  }

  static getTransformMatrix(layer) {
    const params = this.getLayerParams(layer);
    if (!params) return null;

    const { left, top, width, height, canvasWidth, canvasHeight } = params;
    const rotation = params.rotation || 0;

    const glLeft = (left / canvasWidth) * 2 - 1;
    const glRight = ((left + width) / canvasWidth) * 2 - 1;
    const glTop = 1 - (top / canvasHeight) * 2;
    const glBottom = 1 - ((top + height) / canvasHeight) * 2;

    const sx = (glRight - glLeft) / 2;
    const sy = (glTop - glBottom) / 2;
    const centerX = (glLeft + glRight) / 2;
    const centerY = (glTop + glBottom) / 2;

    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const aspect = canvasWidth / canvasHeight;

    return new Float32Array([
      sx * cosR,              sx * sinR * aspect,       0, 0,
      -sy * sinR / aspect,    sy * cosR,                0, 0,
      0,                      0,                        1, 0,
      centerX,                centerY,                  0, 1
    ]);
  }

  static getInverseTransform(xNDC, yNDC, layer) {
    const params = this.getLayerParams(layer);
    if (!params) return { x: xNDC, y: yNDC };

    const { left, top, width, height, canvasWidth, canvasHeight } = params;
    const rotation = params.rotation || 0;

    const glLeft = (left / canvasWidth) * 2 - 1;
    const glRight = ((left + width) / canvasWidth) * 2 - 1;
    const glTop = 1 - (top / canvasHeight) * 2;
    const glBottom = 1 - ((top + height) / canvasHeight) * 2;

    const sx = (glRight - glLeft) / 2;
    const sy = (glTop - glBottom) / 2;
    const centerX_NDC = (glLeft + glRight) / 2;
    const centerY_NDC = (glTop + glBottom) / 2;

    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const aspect = canvasWidth / canvasHeight;

    const dx = xNDC - centerX_NDC;
    const dy = yNDC - centerY_NDC;

    const localX = (dx * cosR + (dy * sinR / aspect)) / sx;
    const localY = (dy * cosR - (dx * sinR * aspect)) / sy;

    return { x: localX, y: localY };
  }
}

export function Layer() {
  const image = ref(null);
  const name = ref('');
  const visible = ref(true);
  const vertices = ref([]);
  const poseVertices = ref([]);
  const indices = ref([]);
  const linesIndices = ref([]);
  const vertexGroup = ref([]);
  const opacity = ref(1.0);
  const attachment = ref(null);
  const drawOrder = ref(0);
  const color = ref([1, 1, 1, 1]);

  function loadImage(url) {
    image.value = url;
    console.log(`Image loaded: ${url}`);
  }

  return {
    image, name, visible, loadImage, vertices, poseVertices, indices, linesIndices, vertexGroup, opacity, attachment, drawOrder, color
  };
}

class gls {
  constructor() {
    this.layers = [];
    this.refLayers = [];
    this.layerMap = {};
  };

  addLayer(layerName) {
    const newLayer = Layer();
    newLayer.name.value = layerName;
    this.layers.push(newLayer);
    this.layerMap[layerName] = newLayer;

    const newRedLayer = Layer();
    newRedLayer.name.value = layerName + 'ref';
    newRedLayer.opacity.value = 0.1;
    this.refLayers.push(newRedLayer);

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
    if (!source) {
      console.error('Shader compilation failed: Source is undefined or empty.');
      return null;
    }

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
    
    if (!vertexShader || !fragmentShader) {
        console.error("Cannot create program because shaders failed to compile.");
        return null;
    }

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

  generateGridVertices(image, width, height, top, left, canvasWidth, canvasHeight, rows = 10, cols = 10, customVertexFunc = null) {
    if (customVertexFunc) {
      return customVertexFunc({ image, width, height, top, left, canvasWidth, canvasHeight, rows, cols });
    }
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
        const texX = (standardX + 1) / 2;
        const texY = (1 - standardY) / 2;

        vertices.push(standardX, standardY, texX, texY);
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

  createLayerBuffers(gl, image, width, height, top, left, canvasWidth, canvasHeight, outputLayer, useGrid = true) {
    let vertices, indices, linesIndices;

    if (useGrid) {
      const gridData = this.generateGridVertices(image, width, height, top, left, canvasWidth, canvasHeight, 10, 10);
      vertices = gridData.vertices;
      indices = gridData.indices;
      linesIndices = gridData.linesIndices;
    } else {
      const x_min = (left / canvasWidth) * 2 - 1;
      const x_max = ((left + width) / canvasWidth) * 2 - 1;
      const y_max = (top / canvasHeight) * -2 + 1;
      const y_min = ((top + height) / canvasHeight) * -2 + 1;

      vertices = [
        x_min, y_max, 0, 0,
        x_max, y_max, 1, 0,
        x_max, y_min, 1, 1,
        x_min, y_min, 0, 1,
      ];
      indices = [0, 3, 2, 0, 2, 1];
      linesIndices = [0, 1, 1, 2, 2, 3, 3, 0];
    }

    const { vbo, ebo, eboLines } = this.createWebGLBuffers(gl, vertices, indices, linesIndices);

    outputLayer.vertices.value = [...vertices];
    outputLayer.poseVertices.value = [...vertices];
    outputLayer.transformParams = {
      left, top, width, height, bottom: height, right: left + width, canvasWidth, canvasHeight,
    };
    outputLayer.vbo = vbo;
    outputLayer.ebo = ebo;
    outputLayer.eboLines = eboLines;
    outputLayer.indices.value = indices;
    outputLayer.linesIndices.value = linesIndices;
    outputLayer.transformParams2 = {
      left, top, width, height, right: left + width, bottom: height,
      canvasWidth, canvasHeight, x: left + width / 2, y: top - height / 2, rotation: 0
    };
  }

  createLayerBuffersByInputLayers(gl, image, width, height, top, left, canvasWidth, canvasHeight, outputLayer, inputLayer) {
    const vertices = [...inputLayer.vertices.value];
    const indices = [...inputLayer.indices.value];
    const linesIndices = [...inputLayer.linesIndices.value];

    const { vbo, ebo, eboLines } = this.createWebGLBuffers(gl, vertices, indices, linesIndices);

    outputLayer.vertices.value = [...vertices];
    outputLayer.poseVertices.value = [...vertices];
    outputLayer.transformParams = { left, top, width, height, canvasWidth, canvasHeight };
    outputLayer.vbo = vbo;
    outputLayer.ebo = ebo;
    outputLayer.eboLines = eboLines;
    outputLayer.indices.value = indices;
    outputLayer.linesIndices.value = linesIndices;
    outputLayer.transformParams2 = {
      left, top, width, height,
      right: left + width / canvasWidth * 2,
      bottom: top - height / canvasHeight * 2,
      canvasWidth, canvasHeight,
      x: left + width / canvasWidth,
      y: top - height / canvasHeight,
      rotation: 0
    };
  }

  updateLayerVertices(gl, layer, options = {}) {
    const {
      update = [], add = [], delete: del = [], addEdge = [], deleteEdge = [],
    } = options;

    let vertices = [...layer.vertices.value];
    let indices = [...layer.indices.value];
    let linesIndices = [...layer.linesIndices.value];
    const vertexSize = 4; // [localX, localY, texX, texY]

    const edgeKey = (v1, v2) => {
      const [a, b] = v1 < v2 ? [v1, v2] : [v2, v1];
      return `${a}-${b}`;
    };

    if (!layer.edges) {
      layer.edges = new Set();
      for (let i = 0; i < linesIndices.length; i += 2) {
        layer.edges.add(edgeKey(linesIndices[i], linesIndices[i + 1]));
      }
    }

    if (!layer.originalTriangles) {
      layer.originalTriangles = new Set();
      for (let i = 0; i < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]].sort((a, b) => a - b).join('-');
        layer.originalTriangles.add(tri);
      }
    }

    const toTexCoord = (localX, localY) => {
      return [(localX + 1) / 2, (1 - localY) / 2];
    };

    const findTriangles = (edges) => {
      const triangles = [];
      const edgeMap = new Map();
      for (const key of edges) {
        const [v1, v2] = key.split('-').map(Number);
        if (!edgeMap.has(v1)) edgeMap.set(v1, new Set());
        if (!edgeMap.has(v2)) edgeMap.set(v2, new Set());
        edgeMap.get(v1).add(v2);
        edgeMap.get(v2).add(v1);
      }
      const visited = new Set();
      for (const [v1, neighbors1] of edgeMap) {
        for (const v2 of neighbors1) {
          if (v2 <= v1) continue;
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

    // 1️⃣ Update Vertex Positions (Using Shared Transform Logic)
    for (const { index, x: worldX, y: worldY } of update) {
      const i = index * vertexSize;
      if (i + 1 < vertices.length) {
        const { x: localX, y: localY } = TransformManager.getInverseTransform(worldX, worldY, layer);
        vertices[i] = localX;
        vertices[i + 1] = localY;
        const [texX, texY] = toTexCoord(localX, localY);
        vertices[i + 2] = texX;
        vertices[i + 3] = texY;
      }
    }

    // 2️⃣ Delete Vertices
    if (del.length > 0) {
      const sortedDel = [...del].sort((a, b) => b - a);
      const newEdges = new Set();
      for (const key of layer.edges) {
        const [v1, v2] = key.split('-').map(Number);
        if (!del.includes(v1) && !del.includes(v2)) {
          const newV1 = v1 - del.filter(d => d < v1).length;
          const newV2 = v2 - del.filter(d => d < v2).length;
          newEdges.add(edgeKey(newV1, newV2));
        }
      }
      layer.edges = newEdges;

      const newOriginalTriangles = new Set();
      for (const triKey of layer.originalTriangles) {
        const [v1, v2, v3] = triKey.split('-').map(Number);
        if (!del.includes(v1) && !del.includes(v2) && !del.includes(v3)) {
          const newV1 = v1 - del.filter(d => d < v1).length;
          const newV2 = v2 - del.filter(d => d < v2).length;
          const newV3 = v3 - del.filter(d => d < v3).length;
          newOriginalTriangles.add([newV1, newV2, newV3].sort((a, b) => a - b).join('-'));
        }
      }
      layer.originalTriangles = newOriginalTriangles;

      for (const index of sortedDel) vertices.splice(index * vertexSize, vertexSize);

      const getNewIndex = (oldIndex) => oldIndex - del.filter(d => d < oldIndex).length;

      let newIndices = [];
      for (let i = 0; i < indices.length; i += 3) {
        const v1 = indices[i], v2 = indices[i + 1], v3 = indices[i + 2];
        if (!del.includes(v1) && !del.includes(v2) && !del.includes(v3)) {
          newIndices.push(getNewIndex(v1), getNewIndex(v2), getNewIndex(v3));
        }
      }
      indices = newIndices;

      let newLinesIndices = [];
      for (let i = 0; i < linesIndices.length; i += 2) {
        const v1 = linesIndices[i], v2 = linesIndices[i + 1];
        if (!del.includes(v1) && !del.includes(v2)) {
          newLinesIndices.push(getNewIndex(v1), getNewIndex(v2));
        }
      }
      linesIndices = newLinesIndices;
    }

    // 3️⃣ Add Vertices (Using Shared Transform Logic)
    if (add.length > 0) {
      for (const { x: worldX, y: worldY, texX = null, texY = null } of add) {
        const { x: localX, y: localY } = TransformManager.getInverseTransform(worldX, worldY, layer);
        const [tx, ty] = texX != null ? [texX, texY] : toTexCoord(localX, localY);
        vertices.push(localX, localY, tx, ty);
      }
    }

    // 4️⃣ Add Edges
    if (addEdge.length > 0) {
      const vertexCount = vertices.length / vertexSize;
      for (const { v1, v2 } of addEdge) {
        if (v1 >= 0 && v1 < vertexCount && v2 >= 0 && v2 < vertexCount && v1 !== v2) {
          const key = edgeKey(v1, v2);
          if (!layer.edges.has(key)) {
            layer.edges.add(key);
            linesIndices.push(v1, v2);
          }
        }
      }
      const newTriangles = findTriangles(layer.edges);
      const existingTriangles = new Set([...layer.originalTriangles]);
      for (let i = 0; i < indices.length; i += 3) {
        existingTriangles.add([indices[i], indices[i + 1], indices[i + 2]].sort((a, b) => a - b).join('-'));
      }
      for (const [v1, v2, v3] of newTriangles) {
        const triKey = [v1, v2, v3].sort((a, b) => a - b).join('-');
        if (!existingTriangles.has(triKey)) indices.push(v1, v2, v3);
      }
    }

    // 5️⃣ Delete Edges
    if (deleteEdge.length > 0) {
      const deletedEdges = new Set();
      for (const { v1, v2 } of deleteEdge) {
        const key = edgeKey(v1, v2);
        layer.edges.delete(key);
        deletedEdges.add(key);
      }

      for (let i = 0; i < linesIndices.length; i += 2) {
         const key = edgeKey(linesIndices[i], linesIndices[i+1]);
         if (deletedEdges.has(key)) {
            linesIndices.splice(i, 2);
            i -= 2;
         }
      }

      const triangleHasDeletedEdge = (v1, v2, v3) => {
        return deletedEdges.has(edgeKey(v1, v2)) || deletedEdges.has(edgeKey(v2, v3)) || deletedEdges.has(edgeKey(v1, v3));
      };

      const validDynamicTriangles = findTriangles(layer.edges);
      const allValidTriangles = new Set();
      const newOriginalTriangles = new Set();

      for (const triKey of layer.originalTriangles) {
        const [v1, v2, v3] = triKey.split('-').map(Number);
        if (!triangleHasDeletedEdge(v1, v2, v3)) {
          newOriginalTriangles.add(triKey);
          allValidTriangles.add(triKey);
        }
      }
      layer.originalTriangles = newOriginalTriangles;

      for (const [v1, v2, v3] of validDynamicTriangles) {
        allValidTriangles.add([v1, v2, v3].sort((a, b) => a - b).join('-'));
      }

      indices = [];
      for (const triKey of allValidTriangles) {
        const [v1, v2, v3] = triKey.split('-').map(Number);
        indices.push(v1, v2, v3);
      }
    }

    // 6️⃣ Update Buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.eboLines);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(linesIndices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    // 7️⃣ Update State
    layer.vertices.value = [...vertices];
    layer.poseVertices.value = [...vertices];
    layer.indices.value = indices;
    layer.linesIndices.value = linesIndices;
  }

  saveInitialState(layer, mouseX, mouseY, centerX, centerY, width, height, rotation) {
    layer.initialMouseX = mouseX;
    layer.initialMouseY = mouseY;
    layer.initialCenterX = centerX;
    layer.initialCenterY = centerY;
    layer.initialWidth = width;
    layer.initialHeight = height;
    layer.initialRotation = rotation;
  }

  updateMousePosition(xNDC, yNDC, layer) {
    const { canvasWidth, canvasHeight } = layer.transformParams;
    const mouseWorldX = (xNDC + 1) * canvasWidth / 2;
    const mouseWorldY = (1 - yNDC) * canvasHeight / 2;
    return { mouseWorldX, mouseWorldY };
  }

  handleBoundaryInteraction(xNDC, yNDC, layers, currentChosedLayerRef) {
    const currentChosedLayer = currentChosedLayerRef.value;
    const baseLayer = layers[currentChosedLayer];
    if (!baseLayer) return -1;

    // Use Shared Transform Logic
    const transformMatrix = TransformManager.getTransformMatrix(baseLayer);
    if (!transformMatrix) return -1;
    
    // Need params for threshold and canvas calculation
    const params = TransformManager.getLayerParams(baseLayer);
    const { canvasWidth, canvasHeight, width, height, rotation = 0 } = params;

    const mouseCanvasX = (xNDC + 1) * canvasWidth / 2;
    const mouseCanvasY = (1 - yNDC) * canvasHeight / 2;

    const localVerts = [[-1, -1, 0, 1], [1, -1, 0, 1], [1, 1, 0, 1], [-1, 1, 0, 1]];
    const boundaryWorldVerts = [];
    
    const m = transformMatrix;
    const transformPoint = (v) => [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3]
    ];

    for (const v of localVerts) {
      const ndc = transformPoint(v);
      const px = (ndc[0] * 0.5 + 0.5) * canvasWidth;
      const py = (1 - (ndc[1] * 0.5 + 0.5)) * canvasHeight;
      boundaryWorldVerts.push([px, py]);
    }

    const centerX = (boundaryWorldVerts[0][0] + boundaryWorldVerts[2][0]) / 2;
    const centerY = (boundaryWorldVerts[0][1] + boundaryWorldVerts[2][1]) / 2;

    const threshold = Math.max(5, 0.02 * canvasWidth);
    const thresholdSq = threshold * threshold;

    // 1. Check Vertices
    const vertexMapping = [3, 2, 1, 0];
    for (let i = 0; i < 4; i++) {
        const [cx, cy] = boundaryWorldVerts[vertexMapping[i]];
        const distSq = (cx - mouseCanvasX) ** 2 + (cy - mouseCanvasY) ** 2;
        if (distSq < thresholdSq) {
            this.saveInitialState(baseLayer, mouseCanvasX, mouseCanvasY, centerX, centerY, width, height, rotation);
            return i;
        }
    }

    // 2. Check Edges
    const edges = [[3, 2], [2, 1], [1, 0], [0, 3]];
    for (let e = 0; e < 4; e++) {
        const [ax, ay] = boundaryWorldVerts[edges[e][0]];
        const [bx, by] = boundaryWorldVerts[edges[e][1]];
        const edgeVecX = bx - ax, edgeVecY = by - ay;
        const edgeLenSq = edgeVecX ** 2 + edgeVecY ** 2;
        if (edgeLenSq < 1e-6) continue;
        
        const t = Math.max(0, Math.min(1, ((mouseCanvasX - ax) * edgeVecX + (mouseCanvasY - ay) * edgeVecY) / edgeLenSq));
        const distSq = (mouseCanvasX - (ax + t * edgeVecX)) ** 2 + (mouseCanvasY - (ay + t * edgeVecY)) ** 2;
        
        if (distSq < thresholdSq) {
            this.saveInitialState(baseLayer, mouseCanvasX, mouseCanvasY, centerX, centerY, width, height, rotation);
            return e + 4;
        }
    }

    // 3. Check Inside
    if (this.isPointInPolygon(mouseCanvasX, mouseCanvasY, boundaryWorldVerts)) {
        this.saveInitialState(baseLayer, mouseCanvasX, mouseCanvasY, centerX, centerY, width, height, rotation);
        return 8;
    }
    return -1;
  }

  updateBoundary(xNDC, yNDC, selected, layer, isShiftPressed) {
    if (selected === -1) return;
    const params = layer.transformParams;
    if (!params) return;
    const { canvasWidth, canvasHeight } = params;

    const mouseCanvasX = (xNDC + 1) * canvasWidth / 2;
    const mouseCanvasY = (1 - yNDC) * canvasHeight / 2;

    let { initialCenterX: centerX, initialCenterY: centerY, initialWidth: width, initialHeight: height, initialRotation: rotation } = layer;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    if (selected === 8) {
      centerX += mouseCanvasX - layer.initialMouseX;
      centerY += mouseCanvasY - layer.initialMouseY;
    } else if (selected < 4 && isShiftPressed) {
      const angle0 = Math.atan2(layer.initialMouseY - layer.initialCenterY, layer.initialMouseX - layer.initialCenterX);
      const angle1 = Math.atan2(mouseCanvasY - centerY, mouseCanvasX - centerX);
      rotation = layer.initialRotation - (angle1 - angle0);
    } else {
      const dx = mouseCanvasX - centerX;
      const dy = mouseCanvasY - centerY;
      // Use Pure Pixel space rotation (No Aspect needed)
      const localX = dx * cosR + dy * sinR; 
      const localY = -dx * sinR + dy * cosR;

      if (selected < 4) {
        width = Math.max(10, Math.abs(dx * cosR - dy * sinR) * 2);
        height = Math.max(10, Math.abs(dx * sinR + dy * cosR) * 2);
      } else {
         const idx = selected - 4;
         if (idx === 1 || idx === 3) width = Math.max(10, Math.abs(localX) * 2);
         if (idx === 0 || idx === 2) height = Math.max(10, Math.abs(localY) * 2);
      }
    }

    const newParams = {
      left: centerX - width / 2,
      top: centerY - height / 2,
      right: centerX + width / 2,
      bottom: centerY + height / 2,
      width, height, rotation, canvasWidth, canvasHeight
    };

    Object.assign(layer.transformParams, newParams);
    if (layer.transformParams2) Object.assign(layer.transformParams2, newParams);
    if (layer.innerTransformParams) Object.assign(layer.innerTransformParams, newParams);
    return newParams;
  }

  isPointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
}

// 📤 Exported Functions

export const setCurrentJobName = (jobName) => {
  currentJobName.value = jobName;
}

var time = 0;
export const render2 = (gl, program, colorProgram, skeletonProgram, renderLayer, selectedLayers, passes, jobName, beforePasses) => {
  if (currentJobName.value != jobName) return;

  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  time += 0.016;
  
  if (beforePasses) beforePasses.forEach(pass => pass());

  if (render(gl, program, renderLayer, selectedLayers) !== false) {
    if (passes) passes.forEach(pass => pass());
    requestAnimationFrame(() => render2(gl, program, colorProgram, skeletonProgram, renderLayer, selectedLayers, passes, jobName, beforePasses));
  }
};

export const render = (gl, program, renderLayer, selectedLayers) => {
  if (gl.isContextLost() || !program || !gl.isProgram(program)) return false;
  if (!selectedLayers) selectedLayers.value = [];

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  if (!texture.value || texture.value.length === 0) return false;

  const textures = texture.value;
  gl.useProgram(program);

  let layerIndices = selectedLayers.value.sort((a, b) => a - b);

  for (const layerIndex of layerIndices) {
    if (layerIndex >= textures.length) continue;
    const tex = textures[layerIndex];
    const layer = renderLayer[layerIndex];

    if (!tex || !tex.tex || !layer || !layer.vbo || !layer.visible) continue;

    gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ebo);

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

    // ✨ Use Unified Transform Manager
    const transformMatrix = TransformManager.getTransformMatrix(layer);
    if (transformMatrix) {
      gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uTransform'), false, transformMatrix);
    }

    const opacityLocation = gl.getUniformLocation(program, 'uOpacity');
    if (opacityLocation !== null) gl.uniform1f(opacityLocation, layer.opacity?.value ?? 1.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);

    gl.drawElements(gl.TRIANGLES, layer.indices.value.length, gl.UNSIGNED_SHORT, 0);
  }

  // Debug Points Rendering
  const debugPoints = [];
  for (const layerIndex of layerIndices) {
     if (layerIndex >= textures.length) continue;
     const layer = renderLayer[layerIndex];
     if (layer.visible === false) continue;
     const params = layer.poseTransformParams;
     if (params && params.debugPivot) {
        debugPoints.push(
            (params.debugPivot.x / params.canvasWidth) * 2 - 1,
            1 - (params.debugPivot.y / params.canvasHeight) * 2
        );
     }
  }

  if (debugPoints.length > 0 && colorProgram.value) {
    const cProg = colorProgram.value;
    gl.useProgram(cProg);
    const uTransform = gl.getUniformLocation(cProg, 'uTransform');
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    if (uTransform) gl.uniformMatrix4fv(uTransform, false, identity);
    renderPoints(gl, cProg, gl.getAttribLocation(cProg, 'aPosition'), new Float32Array(debugPoints), [1, 0, 1, 1], 10.0);
  }
};

export const makeRenderPass = (fn, ...args) => () => fn(...args);

export const renderMeshSkeleton = (gl, skeletonProgram, meshSkeleton, bonesInstance, mousePressed, activeTool) => {
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
}

export const renderMeshSkeleton2 = (gl, skeletonProgram, meshSkeleton, bonesInstance, mousePressed, activeTool, canvasWidth, canvasHeight) => {
  // 保存當前WebGL狀態
  let drawPoseBone = (activeTool.value === "bone-animate");
  //console.log("canvasWidth: ", { canvasWidth, canvasHeight });

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
        let headNDCx = transform.head.x / canvasWidth * 2 - 1;
        let headNDCy = 1 - transform.head.y / canvasHeight * 2;

        let tailNDCx = transform.tail.x / canvasWidth * 2 - 1;
        let tailNDCy = 1 - transform.tail.y / canvasHeight * 2;

        vertices.push(headNDCx, headNDCy);
        vertices.push(tailNDCx, tailNDCy);

        headVertices.push(headNDCx, headNDCy);
        tailVertices.push(tailNDCx, tailNDCy);

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
      let headNDCx1 = mousedown_x / canvasWidth * 2 - 1;
      let headNDCy1 = 1 - mousedown_y / canvasHeight * 2;

      let headNDCx2 = mousemove_x / canvasWidth * 2 - 1;
      let headNDCy2 = 1 - mousemove_y / canvasHeight * 2;


      if (activeTool.value === "bone-create") {
        const tempVertices = new Float32Array([headNDCx1, headNDCy1, headNDCx2, headNDCy2]);
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
      if (activeTool.value === "select-points") {

        // === 渲染拖曳範圍方形框 ===
        const rectVertices = new Float32Array([
          headNDCx1, headNDCy1,  // 左下
          headNDCx2, headNDCy1,  // 右下
          headNDCx2, headNDCy2,  // 右上
          headNDCx1, headNDCy2   // 左上
        ]);
        const rectIndices = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]); // 四條邊

        const rectVbo = gl.createBuffer();
        const rectEbo = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, rectVbo);
        gl.bufferData(gl.ARRAY_BUFFER, rectVertices, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rectEbo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, rectIndices, gl.STATIC_DRAW);

        gl.enableVertexAttribArray(skeletonPosAttrib);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

        console.log("draw rectangle frame", dragBoneData);
        // 半透明黃色方形框
        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 1, 0, 0.5);
        gl.drawElements(gl.LINES, rectIndices.length, gl.UNSIGNED_SHORT, 0);

        gl.deleteBuffer(rectVbo);
        gl.deleteBuffer(rectEbo);
      }
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
}

// Helper to render points
const renderPoints = (gl, program, posAttrib, verticesPoints, color, pointSize) => {
  const vbo_temp = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo_temp);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verticesPoints), gl.STATIC_DRAW);
  gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);

  gl.uniform4f(gl.getUniformLocation(program, 'uColor'), ...color);
  gl.uniform1f(gl.getUniformLocation(program, 'uPointSize'), pointSize);
  gl.drawArrays(gl.POINTS, 0, verticesPoints.length / 2);

  gl.deleteBuffer(vbo_temp); 
};

export function renderWeightPaint(gl, program, selectedGroupName, layer, isWeightPaintMode) {
  if (!isWeightPaintMode || !layer || !layer.vertexGroup || !layer.vertices.value) return;
  const group = layer.vertexGroup.value.find(g => g.name === selectedGroupName);
  if (!group || !group.vertices || group.vertices.length === 0) return;

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ebo);

  const positionAttrib = gl.getAttribLocation(program, 'aPosition');
  if (positionAttrib !== -1) {
    gl.enableVertexAttribArray(positionAttrib);
    gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 16, 0);
  }

  // ✨ Use Unified Transform Manager
  const transformMatrix = TransformManager.getTransformMatrix(layer);
  if (transformMatrix) gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uTransform'), false, transformMatrix);

  const colorLocation = gl.getUniformLocation(program, 'uColor');
  const weightMap = new Map();
  group.vertices.forEach(v => weightMap.set(v.id, v.weight));

  const indices = layer.indices.value;
  for (let i = 0; i < indices.length; i += 3) {
    const idx0 = indices[i], idx1 = indices[i + 1], idx2 = indices[i + 2];
    if (!weightMap.has(idx0) && !weightMap.has(idx1) && !weightMap.has(idx2)) continue;

    const w0 = weightMap.get(idx0) || 0;
    const w1 = weightMap.get(idx1) || 0;
    const w2 = weightMap.get(idx2) || 0;
    
    const count = (weightMap.has(idx0) ? 1 : 0) + (weightMap.has(idx1) ? 1 : 0) + (weightMap.has(idx2) ? 1 : 0);
    const avgWeight = (w0 + w1 + w2) / (count || 1); // Avoid div by zero

    const color = weightToColor(avgWeight);
    gl.uniform4f(colorLocation, color.r, color.g, color.b, 0.5);
    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, i * 2);
  }
}

function weightToColor(weight) {
  let r, g, b;
  if (weight < 0.25) { const t = weight / 0.25; r = 0; g = t; b = 1; }
  else if (weight < 0.5) { const t = (weight - 0.25) / 0.25; r = 0; g = 1; b = 1 - t; }
  else if (weight < 0.75) { const t = (weight - 0.5) / 0.25; r = t; g = 1; b = 0; }
  else { const t = (weight - 0.75) / 0.25; r = 1; g = 1 - t; b = 0; }
  return { r, g, b };
}

export function renderGridOnly(gl, colorProgram, layers, layerSize, currentChosedLayerRef, selectedVertices) {
  if (!selectedVertices) return;
  const currentChosedLayer = currentChosedLayerRef.value;
  const baseLayer = layers[currentChosedLayer];
  if (layerSize === 0 || currentChosedLayer >= layerSize || !baseLayer || !baseLayer.vbo) return;

  gl.useProgram(colorProgram);

  // ✨ Use Unified Transform Manager
  const transformMatrix = TransformManager.getTransformMatrix(baseLayer);
  if (transformMatrix) gl.uniformMatrix4fv(gl.getUniformLocation(colorProgram, 'uTransform'), false, transformMatrix);

  gl.bindBuffer(gl.ARRAY_BUFFER, baseLayer.vbo);
  const colorPosAttrib = gl.getAttribLocation(colorProgram, 'aPosition');
  if (colorPosAttrib !== -1) {
    gl.enableVertexAttribArray(colorPosAttrib);
    gl.vertexAttribPointer(colorPosAttrib, 2, gl.FLOAT, false, 16, 0);
  }

  if (baseLayer.eboLines && baseLayer.linesIndices.value.length > 0) {
    gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 1, 1, 0.3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, baseLayer.eboLines);
    gl.drawElements(gl.LINES, baseLayer.linesIndices.value.length, gl.UNSIGNED_SHORT, 0);
  }

  if (baseLayer.vertices.value.length > 0) {
    const pointSizeLocation = gl.getUniformLocation(colorProgram, 'uPointSize');
    if (pointSizeLocation) gl.uniform1f(pointSizeLocation, 3.0);
    gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 1, 0, 0, 1);
    gl.drawArrays(gl.POINTS, 0, baseLayer.vertices.value.length / 4);

    if (selectedVertices.value.length > 0) {
      if (pointSizeLocation) gl.uniform1f(pointSizeLocation, 6.0);
      gl.uniform4f(gl.getUniformLocation(colorProgram, 'uColor'), 0, 1, 0, 1);
      for (let idx of selectedVertices.value) gl.drawArrays(gl.POINTS, idx, 1);
    }
  }
}

export function fitTransformToVertices(layer) {
  const vertices = layer.vertices.value;
  if (!vertices || vertices.length < 2) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < vertices.length; i += 4) {
    minX = Math.min(minX, vertices[i]);
    maxX = Math.max(maxX, vertices[i]);
    minY = Math.min(minY, vertices[i + 1]);
    maxY = Math.max(maxY, vertices[i + 1]);
  }

  const { canvasWidth, canvasHeight } = layer.transformParams2;
  const newWidth = (maxX - minX) * canvasWidth / 2;
  const newHeight = (maxY - minY) * canvasHeight / 2;

  layer.transformParams3 = {
    left: minX, top: minY, width: newWidth, height: newHeight, right: maxX, bottom: maxY, canvasWidth, canvasHeight
  };
  return layer.transformParams3;
}

export function fitTransformToVertices2(layer) {
  const vertices = layer.vertices.value;
  if (!vertices || vertices.length < 2) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < vertices.length; i += 4) {
    minX = Math.min(minX, vertices[i]);
    maxX = Math.max(maxX, vertices[i]);
    minY = Math.min(minY, vertices[i + 1]);
    maxY = Math.max(maxY, vertices[i + 1]);
  }

  const { canvasWidth, canvasHeight } = layer.transformParams2;
  const newWidth = (maxX - minX) * canvasWidth / 2;
  const newHeight = (maxY - minY) * canvasHeight / 2;

  layer.transformParams = {
    left: minX, top: maxY, width: newWidth, height: newHeight, right: maxX, bottom: minY, canvasWidth, canvasHeight
  };
  return layer.transformParams;
}

export function renderOutBoundary(gl, colorProgram, layers, layerSize, currentChosedLayerRef, selectedVertices) {
  if (!selectedVertices) selectedVertices = { value: [] };
  const currentChosedLayer = currentChosedLayerRef.value;
  const baseLayer = layers[currentChosedLayer];
  if (!baseLayer || !baseLayer.vbo || layerSize === 0) return;

  gl.useProgram(colorProgram);

  // ✨ Use Unified Transform Manager
  const transformMatrix = TransformManager.getTransformMatrix(baseLayer);
  const transformLocation = gl.getUniformLocation(colorProgram, 'uTransform');

  if (transformMatrix && transformLocation) {
    gl.uniformMatrix4fv(transformLocation, false, transformMatrix);

    boundaryWorldVerts = [];
    const localVerts = [[-1, -1, 0, 1], [1, -1, 0, 1], [1, 1, 0, 1], [-1, 1, 0, 1]];
    const { canvasWidth, canvasHeight } = TransformManager.getLayerParams(baseLayer);
    
    const m = transformMatrix;
    const transformPoint = (v) => [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3]
    ];

    for (const v of localVerts) {
      const ndc = transformPoint(v);
      const px = (ndc[0] * 0.5 + 0.5) * canvasWidth;
      const py = (1 - (ndc[1] * 0.5 + 0.5)) * canvasHeight;
      boundaryWorldVerts.push([px, py]);
    }
  }

  // Draw Boundary Rect
  const boundaryVertices = new Float32Array([-1, -1, 0, 0, 1, -1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0]);
  const boundaryVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, boundaryVBO);
  gl.bufferData(gl.ARRAY_BUFFER, boundaryVertices, gl.STATIC_DRAW);

  const colorPosAttrib = gl.getAttribLocation(colorProgram, 'aPosition');
  if (colorPosAttrib !== -1) {
    gl.enableVertexAttribArray(colorPosAttrib);
    gl.vertexAttribPointer(colorPosAttrib, 2, gl.FLOAT, false, 16, 0);
  }

  const uColor = gl.getUniformLocation(colorProgram, 'uColor');
  const uPointSize = gl.getUniformLocation(colorProgram, 'uPointSize');

  const lineIndices = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]);
  const lineEBO = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineEBO);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STATIC_DRAW);
  gl.uniform4f(uColor, 0.1, 1.0, 0.3, 1.0);
  gl.drawElements(gl.LINES, lineIndices.length, gl.UNSIGNED_SHORT, 0);

  if (uPointSize) gl.uniform1f(uPointSize, 20.0);
  gl.drawArrays(gl.POINTS, 0, 4);

  // Center point
  const centerVertex = new Float32Array([0, 0, 0, 0]);
  const centerVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, centerVBO);
  gl.bufferData(gl.ARRAY_BUFFER, centerVertex, gl.STATIC_DRAW);
  gl.vertexAttribPointer(colorPosAttrib, 2, gl.FLOAT, false, 16, 0);
  
  if (uPointSize) gl.uniform1f(uPointSize, 20.0);
  gl.uniform4f(uColor, 1.0, 1.0, 0.0, 1.0);
  gl.drawArrays(gl.POINTS, 0, 1);
  
  if (uPointSize) gl.uniform1f(uPointSize, 10.0);
  gl.uniform4f(uColor, 0.0, 0.0, 0.0, 1.0);
  gl.drawArrays(gl.POINTS, 0, 1);

  gl.deleteBuffer(boundaryVBO);
  gl.deleteBuffer(lineEBO);
  gl.deleteBuffer(centerVBO);

  // Debug Mouse Point (unchanged)
  if (debugMousePos && !isNaN(debugMousePos.x)) {
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    gl.uniformMatrix4fv(gl.getUniformLocation(colorProgram, 'uTransform'), false, identity);
    const debugVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, debugVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([debugMousePos.x, debugMousePos.y, 0, 0]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(colorPosAttrib, 2, gl.FLOAT, false, 16, 0);
    
    if (uPointSize) gl.uniform1f(uPointSize, 20.0);
    gl.uniform4f(uColor, 1.0, 0.0, 0.0, 1.0);
    gl.drawArrays(gl.POINTS, 0, 1);
    
    if (uPointSize) gl.uniform1f(uPointSize, 10.0);
    gl.uniform4f(uColor, 1.0, 1.0, 1.0, 1.0);
    gl.drawArrays(gl.POINTS, 0, 1);
    gl.deleteBuffer(debugVBO);
  }
}

export const layerToTexture = (gl, layer) => {
  return new Promise((resolve, reject) => {
    const { imageData, width, height } = layer;
    if (!imageData || width <= 0 || height <= 0) {
      reject(new Error('Invalid Layer Data'));
      return;
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);

    resolve({ tex: texture, coords: { top: layer.top, left: layer.left, bottom: layer.bottom, right: layer.right }, width, height, top: layer.top, left: layer.left, image: imageData });
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
        texture: currentTexture, data: imgData.data, width: image.width, height: image.height, src: image.src, name: url.split('/').pop()
      });
    };
    image.onerror = reject;
    image.src = url;
  });
};

export const clearTexture = (selectedLayers) => {
  glsInstance.clearAllLayer();
  selectedLayers.value = [];
}

export const pngLoadTexture = async (path) => {
  loadedImage.value = await loadTexture(gl.value, path);
  glsInstance.addLayer("QQ");
  return loadedImage.value;
}

export const pngRender = async () => {
  texture.value = [];
  let result = loadedImage.value;
  let layer = { imageData: result.data, width: result.width, height: result.height, top: 0, left: 0 };
  texture.value.push(await layerToTexture(gl.value, layer));

  let canvasHeight = texture.value[0].height;
  let canvasWidth = texture.value[0].width;
  wholeImageHeight.value = canvasHeight;
  wholeImageWidth.value = canvasWidth;

  for (let i = 0; i < texture.value.length; i++) {
    glsInstance.createLayerBuffers(gl.value, texture.value[i].image, texture.value[i].width, texture.value[i].height, 0, 0, canvasWidth, canvasHeight, glsInstance.layers[i]);
    glsInstance.createLayerBuffers(gl.value, texture.value[i].image, texture.value[i].width, texture.value[i].height, 0, 0, canvasWidth, canvasHeight, glsInstance.refLayers[i], true);
  }
}

export const pngRenderAgain = async () => {
  texture.value = [];
  let result = loadedImage.value;
  let layer = { imageData: result.data, width: result.width, height: result.height, top: 0, left: 0 };
  texture.value.push(await layerToTexture(gl.value, layer));

  let canvasHeight = texture.value[0].height;
  let canvasWidth = texture.value[0].width;
  wholeImageHeight.value = canvasHeight;
  wholeImageWidth.value = canvasWidth;

  for (let i = 0; i < texture.value.length; i++) {
    glsInstance.createLayerBuffersByInputLayers(gl.value, texture.value[i].image, texture.value[i].width, texture.value[i].height, 0, 0, canvasWidth, canvasHeight, glsInstance.layers[i], glsInstance.layers[i]);
    glsInstance.createLayerBuffersByInputLayers(gl.value, texture.value[i].image, texture.value[i].width, texture.value[i].height, 0, 0, canvasWidth, canvasHeight, glsInstance.refLayers[i], glsInstance.layers[i]);
  }
}

export const bindGl = async (selectedLayers) => {
  for (let i = 0; i < texture.value.length; i++) {
    const layer = glsInstance.layers[i];
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
}

export const psdRender = async (selectedLayers, wholeImageHeight, wholeImageWidth) => {
  glsInstance.clearAllLayer();
  texture.value = [];
  let index = 0;
  let canvasHeight = wholeImageWidth; // Wait, is this swapped? Following original logic.
  let canvasWidth = wholeImageHeight;

  for (const layerData of layerForTextureWebgl.value) {
    const texInfo = await layerToTexture(gl.value, layerData);
    texture.value.push(texInfo);
    const layer = glsInstance.addLayer("psd" + index++);
    layer.attachment = new Attachment({ ...layerData, texture: texInfo.tex }); // Fix Here
  }

  for (let i = 0; i < texture.value.length; i++) {
    const layer = glsInstance.layers[i];
    const att = layer.attachment;
    // Fix: Access coords property if available, otherwise fallback or assume direct property if changed
    // Based on previous mesh.js, it's in coords.
    // However, createLayerBuffers expects top, left.
    // Let's pass att.coords.top if available.
    const top = att.coords ? att.coords.top : (att.top || 0);
    const left = att.coords ? att.coords.left : (att.left || 0);

    glsInstance.createLayerBuffers(gl.value, att.image, att.width, att.height, top, left, canvasWidth, canvasHeight, layer);
  }
  console.log("WebGL initialization complete");
}

export const psdRenderAgain = async (selectedLayers, wholeImageHeight, wholeImageWidth) => {
  texture.value = [];
  let canvasHeight = wholeImageWidth;
  let canvasWidth = wholeImageHeight;

  for (const layerData of layerForTextureWebgl.value) {
    const texInfo = await layerToTexture(gl.value, layerData);
    texture.value.push(texInfo);
  }

  for (let i = 0; i < texture.value.length; i++) {
    const layer = glsInstance.layers[i];
    const att = layer.attachment;
     // Fix here too
    const top = att.coords ? att.coords.top : (att.top || 0);
    const left = att.coords ? att.coords.left : (att.left || 0);
    
    glsInstance.createLayerBuffersByInputLayers(gl.value, att.image, att.width, att.height, top, left, canvasWidth, canvasHeight, layer, layer);
    glsInstance.createLayerBuffersByInputLayers(gl.value, att.image, att.width, att.height, top, left, canvasWidth, canvasHeight, glsInstance.refLayers[i], layer);
  }
  console.log("WebGL initialization complete");
}

// ✨ Simplified: Now just a wrapper around TransformManager
export const getMouseLocalPos = (xNDC, yNDC, layer) => {
  return TransformManager.getInverseTransform(xNDC, yNDC, layer);
};

// ✨ Simplified: Use Inverse Transform logic
export const getClosestVertex = (xNDC, yNDC, layer) => {
  const vertices = layer.vertices.value;
  if (!vertices || vertices.length === 0) return -1;

  const { x: localMouseX, y: localMouseY } = TransformManager.getInverseTransform(xNDC, yNDC, layer);
  
  let minDist = 0.05 * 0.05; 
  let localSelectedVertex = -1;

  for (let i = 0; i < vertices.length; i += 4) {
    const dx = vertices[i] - localMouseX;
    const dy = vertices[i + 1] - localMouseY;
    const distSq = dx * dx + dy * dy;

    if (distSq < minDist) {
      minDist = distSq;
      localSelectedVertex = i / 4;
    }
  }
  return localSelectedVertex;
}

export const restoreWebGLResources = async (newGl) => {
  console.log("♻️ Restoring WebGL resources (Fix Black Screen)...");
  if (texture.value && texture.value.length > 0) {
    const processed = new Set();
    for (let i = 0; i < texture.value.length; i++) {
      const texInfo = texture.value[i];
      if (!texInfo || processed.has(texInfo)) continue;

      const newTex = newGl.createTexture();
      newGl.bindTexture(newGl.TEXTURE_2D, newTex);
      newGl.pixelStorei(newGl.UNPACK_FLIP_Y_WEBGL, true);

      if (texInfo.image) {
         if (texInfo.image instanceof Uint8Array || texInfo.image instanceof Uint8ClampedArray) {
             newGl.texImage2D(newGl.TEXTURE_2D, 0, newGl.RGBA, texInfo.width, texInfo.height, 0, newGl.RGBA, newGl.UNSIGNED_BYTE, texInfo.image);
         } else {
             newGl.texImage2D(newGl.TEXTURE_2D, 0, newGl.RGBA, newGl.RGBA, newGl.UNSIGNED_BYTE, texInfo.image);
         }
         newGl.texParameteri(newGl.TEXTURE_2D, newGl.TEXTURE_WRAP_S, newGl.CLAMP_TO_EDGE);
         newGl.texParameteri(newGl.TEXTURE_2D, newGl.TEXTURE_WRAP_T, newGl.CLAMP_TO_EDGE);
         newGl.texParameteri(newGl.TEXTURE_2D, newGl.TEXTURE_MIN_FILTER, newGl.LINEAR);
         newGl.texParameteri(newGl.TEXTURE_2D, newGl.TEXTURE_MAG_FILTER, newGl.LINEAR);
      }
      newGl.bindTexture(newGl.TEXTURE_2D, null);
      texInfo.tex = newTex;
      processed.add(texInfo);
    }
  }

  const rebuildBuffers = (layerList) => {
      for (const layer of layerList) {
        if (layer.vertices.value && layer.vertices.value.length > 0) {
            const { vbo, ebo, eboLines } = glsInstance.createWebGLBuffers(newGl, layer.vertices.value, layer.indices.value, layer.linesIndices.value);
            layer.vbo = vbo;
            layer.ebo = ebo;
            layer.eboLines = eboLines;
        }
      }
  };

  rebuildBuffers(glsInstance.layers);
  rebuildBuffers(glsInstance.refLayers);

  console.log(`✅ WebGL Resources restored. Textures count: ${texture.value.length}, Layers count: ${glsInstance.layers.length}`);
}

export {
  gl, texture, program, colorProgram, skeletonProgram, weightPaintProgram, skinnedProgram, layerForTextureWebgl,
  configSettings, transparentCells, isAreaTransparent
};

const glsInstance = new gls();
export default glsInstance;