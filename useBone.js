const { ref } = Vue;
import glsInstance from './useWebGL.js';

// 📦 全域狀態
const skeletonVertices = ref([]);
const skeletonVerticesLast = ref([]);
const allBones = ref([]);
const originalSkeletonVertices = ref([]);
const boneParents = ref([]);
const boneChildren = ref([]);
const vertexInfluences = ref([]);
const vertexInfluences2 = ref([]);


const isEditingExistingBone = ref(false);
const selectedBoneForEditing = ref(-1);
const editingBoneEnd = ref(null);
const boneEndBeingDragged = ref(null);

let lineIndex = 0;
const minBoneLength = 0.1;

// 📦 外部依賴（由 app.js 呼叫 initBone 設定）
let gl, program, texture, vbo, ebo, indices;
let resetMeshToOriginal, updateMeshForSkeletonPose;

// 📷 匯出圖片（可選）
function downloadImage() {
  const canvas = document.getElementById('webgl');
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');

  function cleanRender() {
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (texture) {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);

      const posAttrib = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(posAttrib);
      gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 16, 0);

      const texAttrib = gl.getAttribLocation(program, 'aTexCoord');
      gl.enableVertexAttribArray(texAttrib);
      gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 16, 8);

      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    }

    const width = canvas.width;
    const height = canvas.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const imageData = tempCtx.createImageData(width, height);
    imageData.data.set(pixels);

    for (let row = 0; row < height / 2; row++) {
      for (let col = 0; col < width * 4; col++) {
        const temp = imageData.data[row * width * 4 + col];
        imageData.data[row * width * 4 + col] =
          imageData.data[(height - row - 1) * width * 4 + col];
        imageData.data[(height - row - 1) * width * 4 + col] = temp;
      }
    }

    tempCtx.putImageData(imageData, 0, 0);
    const dataURL = tempCanvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.href = dataURL;
    downloadLink.download = 'mesh_deformed_image.png';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  }

  gl.flush();
  requestAnimationFrame(cleanRender);
}

export default class Bones {
  constructor(options = {}) {
    this.resetSkeletonToOriginal = this.resetSkeletonToOriginal.bind(this);
    this.applyTransformToChildren = this.applyTransformToChildren.bind(this);
    this.calculateDistance = this.calculateDistance.bind(this);
    this.calculateAngle = this.calculateAngle.bind(this);
    this.rotatePoint = this.rotatePoint.bind(this);
    this.checkKeyframe = this.checkKeyframe.bind(this);
    this.readBones = this.readBones.bind(this);
    this.saveBones = this.saveBones.bind(this);
    this.clearBones = this.clearBones.bind(this);
    this.detectBoneClick = this.detectBoneClick.bind(this);
    this.translateBone = this.translateBone.bind(this);
    this.rotateBone = this.rotateBone.bind(this);

    this.onUpdate = options.onUpdate || function () { };
    this.vueInstance = options.vueInstance || null;
    this.glsInstance = options.glsInstance;
    this.selectedBone = options.selectedBone;
    this.skeletonIndices = options.skeletonIndices;
    this.isShiftPressed = options.isShiftPressed;
    this.parentBoneIndex = -1;
  }

  checkKeyframe() {
    console.log(" hi check keyframe ... ", this.vueInstance.proxy.timeline);
  }

  // 💾 儲存骨架
  saveBones() {
    console.log(" show timeline first :", JSON.stringify(this.vueInstance.proxy.timeline.keyframes));
    const boneData = {
      skeletonVertices: skeletonVertices.value,
      originalSkeletonVertices: originalSkeletonVertices.value,
      boneParents: boneParents.value,
      boneChildren: boneChildren.value,
      vertexInfluences: vertexInfluences.value.map(inf =>
        inf.map(({ boneIndex, weight }) => ({ boneIndex, weight }))
      ),
      keyframes: this.vueInstance.proxy.timeline.keyframes
    };
    localStorage.setItem('boneData', JSON.stringify(boneData));
  }

  // 📥 載入骨架
  readBones() {
    const boneDataStr = localStorage.getItem('boneData');
    if (boneDataStr) {
      const boneData = JSON.parse(boneDataStr);
      skeletonVertices.value = boneData.skeletonVertices;
      originalSkeletonVertices.value = boneData.originalSkeletonVertices;
      boneParents.value = boneData.boneParents;
      boneChildren.value = boneData.boneChildren;
      vertexInfluences.value = boneData.vertexInfluences.map(inf =>
        inf.map(({ boneIndex, weight }) => ({ boneIndex, weight }))
      );
      this.vueInstance.proxy.timeline.keyframes = boneData.keyframes;

      console.log("  checking load  keyframe :", JSON.stringify(boneData.keyframes));

      glsInstance.updateMeshForSkeletonPose?.();
    }
  }

  // 🧹 清除骨架
  clearBones() {
    skeletonVertices.value = [];
    originalSkeletonVertices.value = [];
    boneParents.value = [];
    boneChildren.value = [];
    vertexInfluences.value = [];
    lineIndex = 0;
    isEditingExistingBone.value = false;
    selectedBoneForEditing.value = -1;
    editingBoneEnd.value = null;
    resetMeshToOriginal?.();
  }

  resetSkeletonToOriginal() {
    if (originalSkeletonVertices.value.length > 0) {
      skeletonVertices.value = [...originalSkeletonVertices.value];
    }
  }

  restoreSkeletonVerticesFromLast() {
    if (skeletonVerticesLast.value.length > 0) {
      skeletonVertices.value = [...skeletonVerticesLast.value];
      console.log("skeleton vertices length : ", skeletonVertices.value.length);
      this.glsInstance.updateMeshForSkeletonPose();
    }
  }

  applyTransformToChildren(parentIndex, deltaX, deltaY, rotationAngle, pivotX, pivotY) {
    if (boneChildren.value[parentIndex]) {
      boneChildren.value[parentIndex].forEach(childIndex => {
        const childHeadX = skeletonVertices.value[childIndex * 4];
        const childHeadY = skeletonVertices.value[childIndex * 4 + 1];
        const childTailX = skeletonVertices.value[childIndex * 4 + 2];
        const childTailY = skeletonVertices.value[childIndex * 4 + 3];

        skeletonVertices.value[childIndex * 4] += deltaX;
        skeletonVertices.value[childIndex * 4 + 1] += deltaY;
        skeletonVertices.value[childIndex * 4 + 2] += deltaX;
        skeletonVertices.value[childIndex * 4 + 3] += deltaY;

        if (rotationAngle !== 0) {
          const rotatedHead = this.rotatePoint(pivotX, pivotY, childHeadX, childHeadY, rotationAngle);
          const rotatedTail = this.rotatePoint(pivotX, pivotY, childTailX, childTailY, rotationAngle);
          skeletonVertices.value[childIndex * 4] = rotatedHead.x;
          skeletonVertices.value[childIndex * 4 + 1] = rotatedHead.y;
          skeletonVertices.value[childIndex * 4 + 2] = rotatedTail.x;
          skeletonVertices.value[childIndex * 4 + 3] = rotatedTail.y;
        }

        this.applyTransformToChildren(childIndex, deltaX, deltaY, rotationAngle, pivotX, pivotY);
      });
    }
  }

  calculateDistance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  }

  calculateAngle(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
  }

  rotatePoint(cx, cy, x, y, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = x - cx;
    const dy = y - cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return { x: rx + cx, y: ry + cy };
  }

  assignVerticesToBones() {
    const vertices = skeletonVertices.value;
    allBones.value = [];

    for (let i = 0; i < vertices.length; i += 4) {
      if (i + 3 >= vertices.length) break;
      const bone = {
        head: { x: vertices[i], y: vertices[i + 1] },
        tail: { x: vertices[i + 2], y: vertices[i + 3] }
      };
      allBones.value.push(bone);
    }
    console.log(" hi all bones:", JSON.stringify(allBones.value));
  }

  detectExistingBoneClick(xNDC, yNDC) {
    for (let i = 0; i < skeletonVertices.value.length; i += 4) {
      const headX = skeletonVertices.value[i];
      const headY = skeletonVertices.value[i + 1];
      const tailX = skeletonVertices.value[i + 2];
      const tailY = skeletonVertices.value[i + 3];

      const distToHead = this.calculateDistance(xNDC, yNDC, headX, headY);
      const distToTail = this.calculateDistance(xNDC, yNDC, tailX, tailY);

      if (distToHead < 0.1) {
        return { boneIndex: i / 4, end: 'head' };
      } else if (distToTail < 0.1) {
        return { boneIndex: i / 4, end: 'tail' };
      }
    }
    return null;
  }

  // 完成骨骼創建並檢查有效性
  finalizeBoneCreation(newBoneIndex) {
    const headX = skeletonVertices.value[newBoneIndex * 4];
    const headY = skeletonVertices.value[newBoneIndex * 4 + 1];
    const tailX = skeletonVertices.value[newBoneIndex * 4 + 2];
    const tailY = skeletonVertices.value[newBoneIndex * 4 + 3];
    const distance = Math.sqrt((tailX - headX) ** 2 + (tailY - headY) ** 2);

    if (distance < minBoneLength) {
      this.parentBoneIndex = boneParents.value[this.parentBoneIndex];
      skeletonVertices.value.splice(newBoneIndex * 4, 4);
      boneParents.value.pop();
      this.selectedBone.value = { index: -1 };
    } else {
      const parentIndex = boneParents.value[newBoneIndex];
      if (parentIndex !== -1) {
        if (!boneChildren.value[parentIndex]) boneChildren.value[parentIndex] = [];
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
      this.glsInstance.computeVertexInfluences();
    }
  }

  // 處理滑鼠按下事件
  handleBoneCreateMouseDown(xNDC, yNDC, isShiftPressed) {


    console.log(" [pressed ] hi I should add new point at : ",xNDC,' , ', yNDC);


    isEditingExistingBone.value = false;
    selectedBoneForEditing.value = -1;
    editingBoneEnd.value = null;

    const existingBone = this.detectExistingBoneClick(xNDC, yNDC);
    if (existingBone) {
      selectedBoneForEditing.value = existingBone.boneIndex;
      editingBoneEnd.value = existingBone.end;
      isEditingExistingBone.value = true;
      this.parentBoneIndex = boneParents.value[existingBone.boneIndex];
      this.selectedBone.value = { index: existingBone.boneIndex };
    } else {
      const newBoneIndex = lineIndex;
      if (newBoneIndex === 0) {
        this.parentBoneIndex = -1;
        boneParents.value.push(this.parentBoneIndex);
        skeletonVertices.value.push(xNDC, yNDC, xNDC, yNDC);
        this.selectedBone.value = { index: newBoneIndex };
      } else {
        if (this.selectedBone.value.index != -1) this.parentBoneIndex = this.selectedBone.value.index;
        boneParents.value.push(this.parentBoneIndex);
        if (isShiftPressed) {
          const parentTailX = skeletonVertices.value[this.parentBoneIndex * 4 + 2];
          const parentTailY = skeletonVertices.value[this.parentBoneIndex * 4 + 3];
          skeletonVertices.value.push(parentTailX, parentTailY, parentTailX, parentTailY);
        } else {
          skeletonVertices.value.push(xNDC, yNDC, xNDC, yNDC);
        }
        this.selectedBone.value = { index: newBoneIndex };
      }

      if (this.skeletonIndices.value.length <= newBoneIndex * 2) {
        this.skeletonIndices.value.push(newBoneIndex * 2, newBoneIndex * 2 + 1);
      }
      this.parentBoneIndex = newBoneIndex;
    }
  }

  // 處理滑鼠移動事件
  handleBoneCreateMouseMove(xNDC, yNDC) {

       console.log(" [release ] hi I should add new point at : ",xNDC,' , ', yNDC);

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
  }

  // 處理滑鼠鬆開事件
  handleBoneCreateMouseUp() {
    if (!isEditingExistingBone.value) {
      const newBoneIndex = lineIndex;
      this.finalizeBoneCreation(newBoneIndex);
    }
    selectedBoneForEditing.value = -1;
    editingBoneEnd.value = null;
    isEditingExistingBone.value = false;
  }

  // 提取檢測骨骼點擊的邏輯
  detectBoneClick(xNDC, yNDC) {
    let minDistToSegment = Infinity;
    let selectedBoneIndex = -1;
    let boneEnd = null;

    for (let i = 0; i < skeletonVertices.value.length; i += 4) {
      const headX = skeletonVertices.value[i];
      const headY = skeletonVertices.value[i + 1];
      const tailX = skeletonVertices.value[i + 2];
      const tailY = skeletonVertices.value[i + 3];

      let dx = headX - xNDC;
      let dy = headY - yNDC;
      let dist = dx * dx + dy * dy;
      if (dist < 0.001) {
        selectedBoneIndex = i / 4;
        boneEnd = 'head';
        break;
      }

      dx = tailX - xNDC;
      dy = tailY - yNDC;
      dist = dx * dx + dy * dy;
      if (dist < 0.001) {
        selectedBoneIndex = i / 4;
        boneEnd = 'tail';
        break;
      }

      const distToSegment = this.glsInstance.distanceFromPointToSegment(xNDC, yNDC, headX, headY, tailX, tailY);
      if (distToSegment < 0.1 && distToSegment < minDistToSegment) {
        minDistToSegment = distToSegment;
        selectedBoneIndex = i / 4;
        boneEnd = 'middle';
      }
    }

    return { selectedBoneIndex, boneEnd };
  }

  // 提取平移骨骼的邏輯
  translateBone(boneIndex, deltaX, deltaY) {
    skeletonVertices.value[boneIndex * 4] += deltaX;
    skeletonVertices.value[boneIndex * 4 + 1] += deltaY;
    skeletonVertices.value[boneIndex * 4 + 2] += deltaX;
    skeletonVertices.value[boneIndex * 4 + 3] += deltaY;
    this.applyTransformToChildren(boneIndex, deltaX, deltaY, 0, 0, 0);
  }

  // 提取旋轉骨骼的邏輯
  rotateBone(boneIndex, rotationAngle, pivotX, pivotY) {
    const tailX = skeletonVertices.value[boneIndex * 4 + 2];
    const tailY = skeletonVertices.value[boneIndex * 4 + 3];
    const rotatedTail = this.rotatePoint(pivotX, pivotY, tailX, tailY, rotationAngle);
    skeletonVertices.value[boneIndex * 4 + 2] = rotatedTail.x;
    skeletonVertices.value[boneIndex * 4 + 3] = rotatedTail.y;
    this.applyTransformToChildren(boneIndex, 0, 0, rotationAngle, pivotX, pivotY);
  }

  // 修改後的 handleBoneAnimateMouseDown
  handleBoneAnimateMouseDown(xNDC, yNDC) {
    const { selectedBoneIndex, boneEnd } = this.detectBoneClick(xNDC, yNDC);
    if (selectedBoneIndex >= 0) {
      this.selectedBone.value = { index: selectedBoneIndex };
      boneEndBeingDragged.value = boneEnd;
      if (originalSkeletonVertices.value.length === 0) {
        originalSkeletonVertices.value = [...skeletonVertices.value];
      }
    } else {
      this.selectedBone.value = { index: -1 };
      boneEndBeingDragged.value = null;
    }
  }

  // 修改後的 handleBoneAnimateMouseMove
  handleBoneAnimateMouseMove(prevX, prevY, currX, currY, buttons) {
    if (this.selectedBone.value.index >= 0 && (boneEndBeingDragged.value === 'middle' || boneEndBeingDragged.value === 'tail')) {
      const boneIndex = this.selectedBone.value.index;
      if (buttons === 2) { // Right mouse button for translation
        const deltaX = currX - prevX;
        const deltaY = currY - prevY;
        this.translateBone(boneIndex, deltaX, deltaY);
      } else if (buttons === 1) { // Left mouse button for rotation
        const headX = skeletonVertices.value[boneIndex * 4];
        const headY = skeletonVertices.value[boneIndex * 4 + 1];
        const prevAngle = Math.atan2(prevY - headY, prevX - headX);
        const currentAngle = Math.atan2(currY - headY, currX - headX);
        const rotationAngle = currentAngle - prevAngle;
        this.rotateBone(boneIndex, rotationAngle, headX, headY);
      }
      skeletonVerticesLast.value = [...skeletonVertices.value];
      this.glsInstance.updateMeshForSkeletonPose();
    }
  }

  // handleBoneAnimateMouseUp 保持不變
  handleBoneAnimateMouseUp() {
    boneEndBeingDragged.value = null;
  }
}

// ✅ 匯出
export {
  skeletonVertices,
  skeletonVerticesLast,
  originalSkeletonVertices,
  boneParents,
  boneChildren,
  vertexInfluences,
  vertexInfluences2,
  isEditingExistingBone,
  selectedBoneForEditing,
  editingBoneEnd,
  boneEndBeingDragged,
  downloadImage,
  Bones
};