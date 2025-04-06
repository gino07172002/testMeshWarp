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
    updateMeshForSkeletonPose?.();
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
  downloadImage
};