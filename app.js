const { createApp, onMounted, ref ,reactive} = Vue;
export const selectedBone = ref(-1);

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
  readBones,
} from './useBone.js';

import {
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
  gridCells,
  transparentCells,
  isAreaTransparent,
  imageData,
  imageWidth,
  imageHeight,
} from './useWebGL.js';

import gls from './useWebGL.js';
import Bones from './useBone.js';
import Timeline from './timeline.js';
import ImageCanvasManager from './ImageCanvasManager.js';
// Shader sources
const shaders = {
  vertex: `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;
        varying vec2 vTexCoord;
        void main() {
          gl_Position = vec4(aPosition, 0.0, 1.0);
          vTexCoord = vec2(aTexCoord.x, 1.0 - aTexCoord.y);
        }
      `,
  fragment: `
        precision mediump float;
        varying vec2 vTexCoord;
        uniform sampler2D uTexture;
        void main() {
          gl_FragColor = texture2D(uTexture, vTexCoord);
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

// Coordinate conversion utility function
const convertToNDC = (e, canvas, container) => {
  const rect = container.getBoundingClientRect();
  const scrollLeft = container.scrollLeft;
  const scrollTop = container.scrollTop;

  const x = e.clientX - rect.left + scrollLeft;
  const y = e.clientY - rect.top + scrollTop;

  const scaleX = canvas.width / container.clientWidth;
  const scaleY = canvas.height / container.clientHeight;

  const canvasX = x * scaleX;
  const canvasY = y * scaleY;

  return {
    x: (canvasX / canvas.width) * 2 - 1,
    y: 1 - (canvasY / canvas.height) * 2
  };
};

// Texture Loading Functions
const loadTexture = (gl, url, imageData, imageWidth, imageHeight) => {
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
const timeline = ref(new Timeline());
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
      timelineLength: 1000,
      dragInfo: { dragging: false, startX: 0, type: null },
      timeSelection: { active: false, start: 0, end: 0 },
      animationPlaying: false,
      animationStartTime: 0,
      nextKeyframeId: 10,
      timeline: new Timeline({
        onUpdate: () => this.$forceUpdate(), // 當 timeline 內部數據更新時強制更新 Vue
        vueInstance: this
      }),
      hierarchicalData: {
        children: [
          {
            children: [
              {
                name: "GrandChild"
              }
            ],
            name: "Child1"
          },
          {
            name: "Child2"
          }
        ],
        name: "Root"
      },
      expandedNodes: []
    };
  },
  async mounted() {
    //document.addEventListener('click', this.handleClickOutside);
   // this.startImageUpdates();
   //this.imageCanvasManager = new ImageCanvasManager(this);
  // this.imageCanvasManager.initialize();
    this.addLayer();
    console.log("somehow mount here ... ");
  },
  beforeUnmount() {
    //this.imageCanvasManager.cleanup();
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
      return rootBones.map(rootIndex => this.buildBoneTree(rootIndex));
    },
    flattenedBones() {
      let result = [];
      this.boneTree.forEach(root => {
        this.timeline.getFlattenedBones(root, 0, result);
      });
      console.log(" hi flattenBones: ", JSON.stringify(result));
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
    testCountFn()
    {
      console.log(" in app testCountFn");
      this.timeline.testCount++;
    //  this.timeline.testCountFn();
      //this.$forceUpdate();
    },
    saveProjectToServer() {
      this.status = '正在儲存專案...';
      const projectData = {
        layers: this.layers,
        keyframes: timeline.keyframes,
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
    renderHierarchicalData(node, parentId = '') {
      const nodeId = parentId ? `${parentId}-${node.name}` : node.name;
      const hasChildren = node.children && node.children.length > 0;
      return {
        id: nodeId,
        name: node.name,
        hasChildren: hasChildren,
        children: hasChildren ? node.children.map(child => this.renderHierarchicalData(child, nodeId)) : []
      };
    },
    buildBoneTree(boneIndex) {
      const boneId = `bone${boneIndex}`;
      const boneName = `Bone ${boneIndex}`;
      const children = boneChildren.value[boneIndex] || [];
      return {
        id: boneId,
        name: boneName,
        children: children.map(childIndex => this.buildBoneTree(childIndex))
      };
    },
    toggleNode(nodeId) {
      if (this.expandedNodes.includes(nodeId)) {
        this.expandedNodes = this.expandedNodes.filter(id => id !== nodeId);
      } else {
        this.expandedNodes.push(nodeId);
      }
    },
    handleNameClick(boneIndex) {
      this.selectedBone = boneIndex;
    },
     showBone(){
      console.log("hi show bone");
      console.log("hi bone ",JSON.stringify(this.boneTree));
    }
  },
  setup() {
    const selectedVertex = ref(-1);
    const activeTool = ref('grab-point');
    //const selectedBone = ref(-1); // Shared selected bone for canvas and hierarchy
    const skeletonIndices = ref([]);
    const boneEndBeingDragged = ref(null);
    const isShiftPressed = ref(false);
    let parentBoneIndex = -1;
    let lineIndex = 0;
    const minBoneLength = 0.1;

    const glsInstance = new gls();
    const bonesInstance = new Bones({
      onUpdate: () => this.$forceUpdate(), // 當 timeline 內部數據更新時強制更新 Vue
      vueInstance: this
    });
   
    const selectTool = (tool) => {
      if (activeTool.value === 'bone-animate' && tool !== 'bone-animate') {
        glsInstance.resetMeshToOriginal();
        bonesInstance.resetSkeletonToOriginal();
      } else if (tool === 'bone-clear') {
        clearBones();
        selectedBone.value = -1;
      } else if (tool === 'bone-save') {
        saveBones();
      } else if (tool === 'bone-read') {
        readBones();
      }
      activeTool.value = tool;
    };

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
            isDragging = true;
            isEditingExistingBone.value = false;
            selectedBoneForEditing.value = -1;
            editingBoneEnd.value = null;

            for (let i = 0; i < skeletonVertices.value.length; i += 4) {
              const headX = skeletonVertices.value[i];
              const headY = skeletonVertices.value[i + 1];
              const tailX = skeletonVertices.value[i + 2];
              const tailY = skeletonVertices.value[i + 3];

              const distToHead = bonesInstance.calculateDistance(xNDC, yNDC, headX, headY);
              const distToTail = bonesInstance.calculateDistance(xNDC, yNDC, tailX, tailY);

              if (distToHead < 0.1) {
                selectedBoneForEditing.value = i / 4;
                editingBoneEnd.value = 'head';
                isEditingExistingBone.value = true;
                parentBoneIndex = boneParents.value[i / 4];
                selectedBone.value = i / 4;
              
                break;
              } else if (distToTail < 0.1) {
                selectedBoneForEditing.value = i / 4;
                editingBoneEnd.value = 'tail';
                isEditingExistingBone.value = true;
                parentBoneIndex = i / 4;
                selectedBone.value = i / 4;
                break;
              }
            }

            if (!isEditingExistingBone.value) {
              const newBoneIndex = lineIndex;
              if (newBoneIndex === 0) {
                parentBoneIndex = -1;
                boneParents.value.push(parentBoneIndex);
                skeletonVertices.value.push(xNDC, yNDC, xNDC, yNDC);
                selectedBone.value = newBoneIndex;
              } else {

                console.log("hi parent Bone :", parentBoneIndex, " select bone:", selectedBone.value);
                if (selectedBone.value != -1)
                  parentBoneIndex = selectedBone.value;
                boneParents.value.push(parentBoneIndex);
                if (isShiftPressed.value) {
                  const parentTailX = skeletonVertices.value[parentBoneIndex * 4 + 2];
                  const parentTailY = skeletonVertices.value[parentBoneIndex * 4 + 3];
                  skeletonVertices.value.push(parentTailX, parentTailY, parentTailX, parentTailY);
                } else {
                  skeletonVertices.value.push(xNDC, yNDC, xNDC, yNDC);
                }
                selectedBone.value = newBoneIndex;
              }

              if (skeletonIndices.value.length <= newBoneIndex * 2) {
                skeletonIndices.value.push(newBoneIndex * 2, newBoneIndex * 2 + 1);
              }
              parentBoneIndex = newBoneIndex;
            }
            else
            {
              //show a select bone for debug
             
            }
          } else if (activeTool.value === 'bone-animate') {
            let minDistToSegment = Infinity;
            selectedBone.value = -1;
            boneEndBeingDragged.value = null;

            for (let i = 0; i < skeletonVertices.value.length; i += 4) {
              const headX = skeletonVertices.value[i];
              const headY = skeletonVertices.value[i + 1];
              const tailX = skeletonVertices.value[i + 2];
              const tailY = skeletonVertices.value[i + 3];

              let dx = headX - xNDC;
              let dy = headY - yNDC;
              let dist = dx * dx + dy * dy;
              if (dist < 0.001) {
                selectedBone.value = i / 4;
                boneEndBeingDragged.value = 'head';
                break;
              }

              dx = tailX - xNDC;
              dy = tailY - yNDC;
              dist = dx * dx + dy * dy;
              if (dist < 0.001) {
                selectedBone.value = i / 4;
                boneEndBeingDragged.value = 'tail';
                break;
              }

              const distToSegment = glsInstance.distanceFromPointToSegment(xNDC, yNDC, headX, headY, tailX, tailY);
              if (distToSegment < 0.1 && distToSegment < minDistToSegment) {
                minDistToSegment = distToSegment;
                selectedBone.value = i / 4;
                boneEndBeingDragged.value = 'middle';
              }
            }

            if (selectedBone.value >= 0) {
              isDragging = true;
              if (originalSkeletonVertices.value.length === 0) {
                originalSkeletonVertices.value = [...skeletonVertices.value];
              }
            }
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
        } else if (activeTool.value === 'bone-create') {
          if (isEditingExistingBone.value && selectedBoneForEditing.value >= 0 && editingBoneEnd.value) {
            const boneIndex = selectedBoneForEditing.value;
            if (editingBoneEnd.value === 'head') {
              skeletonVertices.value[boneIndex * 4] = xNDC;
              skeletonVertices.value[boneIndex * 4 + 1] = yNDC;
            } else if (editingBoneEnd.value === 'tail') {
              skeletonVertices.value[boneIndex * 4 + 2] = xNDC;
              skeletonVertices.value[boneIndex * 4 + 3] = yNDC;
            }
          } else {
            skeletonVertices.value[lineIndex * 4 + 2] = xNDC;
            skeletonVertices.value[lineIndex * 4 + 3] = yNDC;
          }
        } else if (activeTool.value === 'bone-animate' && selectedBone.value >= 0) {
          const boneIndex = selectedBone.value;
          if (boneEndBeingDragged.value === 'middle' || boneEndBeingDragged.value === 'tail') {
            if (e.buttons === 2) {
              const deltaX = xNDC - startPosX;
              const deltaY = yNDC - startPosY;
              skeletonVertices.value[boneIndex * 4] += deltaX;
              skeletonVertices.value[boneIndex * 4 + 1] += deltaY;
              skeletonVertices.value[boneIndex * 4 + 2] += deltaX;
              skeletonVertices.value[boneIndex * 4 + 3] += deltaY;
              bonesInstance.applyTransformToChildren(boneIndex, deltaX, deltaY, 0, 0, 0);
              startPosX = xNDC;
              startPosY = yNDC;
            } else if (e.buttons === 1) {
              const headX = skeletonVertices.value[boneIndex * 4];
              const headY = skeletonVertices.value[boneIndex * 4 + 1];
              const prevAngle = Math.atan2(startPosY - headY, startPosX - headX);
              const currentAngle = Math.atan2(yNDC - headY, xNDC - headX);
              const rotationAngle = currentAngle - prevAngle;

              const tailX = skeletonVertices.value[boneIndex * 4 + 2];
              const tailY = skeletonVertices.value[boneIndex * 4 + 3];
              const rotatedTail = bonesInstance.rotatePoint(headX, headY, tailX, tailY, rotationAngle);
              skeletonVertices.value[boneIndex * 4 + 2] = rotatedTail.x;
              skeletonVertices.value[boneIndex * 4 + 3] = rotatedTail.y;

              bonesInstance.applyTransformToChildren(boneIndex, 0, 0, rotationAngle, headX, headY);
              startPosX = xNDC;
              startPosY = yNDC;
            }
          }
          glsInstance.updateMeshForSkeletonPose();
        }
      };

      const handleMouseUp = () => {
        if (activeTool.value === 'bone-create' && isDragging) {
          if (!isEditingExistingBone.value) {
            const newBoneIndex = lineIndex;
            const headX = skeletonVertices.value[newBoneIndex * 4];
            const headY = skeletonVertices.value[newBoneIndex * 4 + 1];
            const tailX = skeletonVertices.value[newBoneIndex * 4 + 2];
            const tailY = skeletonVertices.value[newBoneIndex * 4 + 3];
            const distance = Math.sqrt((tailX - headX) ** 2 + (tailY - headY) ** 2);

            if (distance < minBoneLength) {
              parentBoneIndex = boneParents.value[parentBoneIndex];
              skeletonVertices.value.splice(newBoneIndex * 4, 4);
              boneParents.value.pop();
              selectedBone.value = -1;
            } else {
              const parentIndex = boneParents.value[newBoneIndex];
              if (parentIndex !== -1) {
                if (!boneChildren.value[parentIndex]) {
                  boneChildren.value[parentIndex] = [];
                }
                boneChildren.value[parentIndex].push(newBoneIndex);
              }
              lineIndex++;
              const newBoneStart = newBoneIndex * 4;
              originalSkeletonVertices.value.push(
                skeletonVertices.value[newBoneStart],
                skeletonVertices.value[newBoneStart + 1],
                skeletonVertices.value[newBoneStart + 2],
                skeletonVertices.value[newBoneStart + 3]
              );
              glsInstance.computeVertexInfluences();
            }
          }
        }

        isDragging = false;
        selectedVertex.value = -1;
        boneEndBeingDragged.value = null;
        selectedBoneForEditing.value = -1;
        editingBoneEnd.value = null;
        isEditingExistingBone.value = false;
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

    const render = (gl, program, colorProgram, skeletonProgram) => {
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
        const { skeletonVbo, skeletonEbo, skeletonVerticesArray, skeletonIndicesArray } = glsInstance.createSkeletonBuffers(gl);

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
        const headVertices = [];
        for (let i = 0; i < skeletonVerticesArray.length; i += 4) {
          headVertices.push(skeletonVerticesArray[i], skeletonVerticesArray[i + 1]);
        }
        const headVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, headVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(headVertices), gl.STATIC_DRAW);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

        if (selectedBone.value >= 0) {
          const selectedHeadIndex = selectedBone.value * 4;
          const selectedHeadVbo = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, selectedHeadVbo);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            skeletonVerticesArray[selectedHeadIndex],
            skeletonVerticesArray[selectedHeadIndex + 1]
          ]), gl.STATIC_DRAW);
          gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 0.5, 0, 1);
          gl.uniform1f(gl.getUniformLocation(skeletonProgram, 'uPointSize'), 10.0);
          gl.drawArrays(gl.POINTS, 0, 1);
        }

        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 1, 0, 1);
        gl.uniform1f(gl.getUniformLocation(skeletonProgram, 'uPointSize'), 7.0);
        gl.drawArrays(gl.POINTS, 0, headVertices.length / 2);

        const tailVertices = [];
        for (let i = 0; i < skeletonVerticesArray.length; i += 4) {
          tailVertices.push(skeletonVerticesArray[i + 2], skeletonVerticesArray[i + 3]);
        }
        const tailVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tailVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tailVertices), gl.STATIC_DRAW);
        gl.vertexAttribPointer(skeletonPosAttrib, 2, gl.FLOAT, false, 0, 0);

        if (selectedBone.value >= 0) {
          const selectedTailIndex = selectedBone.value * 4 + 2;
          const selectedTailVbo = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, selectedTailVbo);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            skeletonVerticesArray[selectedTailIndex],
            skeletonVerticesArray[selectedTailIndex + 1]
          ]), gl.STATIC_DRAW);
          gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 1, 0.5, 0, 1);
          gl.uniform1f(gl.getUniformLocation(skeletonProgram, 'uPointSize'), 10.0);
          gl.drawArrays(gl.POINTS, 0, 1);
        }

        gl.uniform4f(gl.getUniformLocation(skeletonProgram, 'uColor'), 0, 0.5, 1, 1);
        gl.uniform1f(gl.getUniformLocation(skeletonProgram, 'uPointSize'), 7.0);
        gl.drawArrays(gl.POINTS, 0, tailVertices.length / 2);
      }

      requestAnimationFrame(() => render(gl, program, colorProgram, skeletonProgram));
    };

    onMounted(async () => {
      const canvas = document.getElementById('webgl');
      const container = canvas.closest('.image-container');
      const webglContext = canvas.getContext('webgl');
      gl.value = webglContext;

      program.value = glsInstance.createProgram(webglContext, shaders.vertex, shaders.fragment);
      colorProgram.value = glsInstance.createProgram(webglContext, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = glsInstance.createProgram(webglContext, shaders.skeletonVertex, shaders.skeletonFragment);

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      try {
        texture.value = await loadTexture(webglContext, './png3.png', imageData, imageWidth, imageHeight);
        glsInstance.createBuffers(webglContext);

        setupCanvasEvents(canvas, webglContext, container);
        render(webglContext, program.value, colorProgram.value, skeletonProgram.value);
        initBone(gl, program, texture, vbo, ebo, indices, glsInstance.resetMeshToOriginal, glsInstance.updateMeshForSkeletonPose);
      } catch (error) {
        console.error("Initialization error:", error);
      }
    });

    return {
      selectTool,
      clearBones,
      saveBones,
      readBones,
      activeTool,
      selectedBone,

    };
  }
});
const TreeItem = {
  props: ['node', 'expandedNodes', 'selectedBone'],
  template: `
    <div class="tree-item">
      <div class="tree-item-header" :class="{ 'highlighted': checkIsSelected() }">
        <span class="tree-toggle-icon" 
              :class="{ 'expanded': expandedNodes.includes(node.id) }" 
              @click.stop="toggleNode(node.id)" 
              v-if="node.children && node.children.length > 0">▶</span>
        <span class="tree-item-name" @click.stop="handleNameClick(node.name)">{{ node.name }}</span>
      </div>
      <div class="tree-children" v-if="expandedNodes.includes(node.id)">
        <tree-item v-for="child in node.children" 
                  :key="child.id" 
                  :node="child" 
                  :expanded-nodes="expandedNodes" 
                  :selected-bone="selectedBone"
                  @toggle-node="$emit('toggle-node', $event)" 
                  @name-click="$emit('name-click', $event)">
        </tree-item>
      </div>
    </div>
  `,
  methods: {
    toggleNode(nodeId) {
      this.$emit('toggle-node', nodeId);
    },
    handleNameClick(name) {
      const boneIndex = parseInt(name.split(' ')[1]);
      this.$emit('name-click', boneIndex);
    },
    checkIsSelected() {
      const boneIndex = parseInt(this.node.name.split(' ')[1]);
      return boneIndex === this.selectedBone; // Use shared selectedBone
    }
  }
};

// 在主組件中註冊
app.component('tree-item', TreeItem);
// 掛載應用
export default app;

