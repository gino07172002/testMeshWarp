//useBone.js

const { ref } = Vue;

// 📦 全域狀態
const skeletonVertices = ref([]);
const originalSkeletonVertices = ref([]);
const boneParents = ref([]);
const boneChildren = ref([]);
const vertexInfluences = ref([]);
const isEditingExistingBone = ref(false);
const selectedBoneForEditing = ref(-1);
const editingBoneEnd = ref(null);

let lineIndex = 0;
// 📦 外部依賴（由 app.js 呼叫 initBone 設定）
let gl, program, texture, vbo, ebo, indices;
let resetMeshToOriginal, updateMeshForSkeletonPose;

// 🔧 初始化依賴
function initBone(glRef, programRef, tex, vb, eb, ind, resetFn, updateFn) {
  gl = glRef;
  program = programRef;
  texture = tex;
  vbo = vb;
  ebo = eb;
  indices = ind;
  resetMeshToOriginal = resetFn;
  updateMeshForSkeletonPose = updateFn;
}

// 🧹 清除骨架
function clearBones() {
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

// 💾 儲存骨架
function saveBones() {
  const boneData = {
    skeletonVertices: skeletonVertices.value,
    originalSkeletonVertices: originalSkeletonVertices.value,
    boneParents: boneParents.value,
    boneChildren: boneChildren.value,
    vertexInfluences: vertexInfluences.value.map(inf =>
      inf.map(({ boneIndex, weight }) => ({ boneIndex, weight }))
    )
  };
  localStorage.setItem('boneData', JSON.stringify(boneData));
}

// 📥 載入骨架
function readBones() {
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
    glsInstance.updateMeshForSkeletonPose?.();
  }
}

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

class bones {
  resetSkeletonToOriginal() {
    if (originalSkeletonVertices.value.length > 0) {
      skeletonVertices.value = [...originalSkeletonVertices.value];
    }
  };

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
  };

  calculateDistance(x1, y1, x2, y2) { return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) };
  calculateAngle(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1) };
  rotatePoint(cx, cy, x, y, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = x - cx;
    const dy = y - cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return { x: rx + cx, y: ry + cy };
  };
}

// ✅ 匯出
export {
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
  downloadImage,

};
export default bones;