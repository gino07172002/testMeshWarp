const { ref, reactive } = Vue;
import glsInstance from './useWebGL.js';
import { Bone as MeshBone, Vertex, Mesh2D, Skeleton, getClosestBoneAtClick } from './mesh.js';

console.log("Creating spine with", MeshBone);
const meshSkeleton = reactive(new Skeleton("HumanSkeleton"));
const skeletons = reactive([meshSkeleton]);
console.log("網格骨骼系統創建完成");
// 📦 全域狀態
const skeletonVertices = ref([]);
const skeletonVerticesLast = ref([]);
const allBones = ref([]);
const originalSkeletonVertices = ref([]);
const boneParents = ref([]);
const boneChildren = ref([]);
const vertexInfluences = ref([]);
const vertexInfluences2 = ref([]);
var mousedown_x = null;
var mousedown_y = null;
var mousemove_x = null;
var mousemove_y = null;

//mesh bone
const lastSelectedBone = ref();
const lastSelectedBonePart = ref(); // 'head', 'tail', or 'middle'
const selectedVertices = ref([]);
const mouseHoveringBone = ref();
const controlStatus = ref('none');  // status of current mouse behavior: 'create', 'edit' 'none'


//old bone system
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
    //this.resetSkeletonToOriginal = this.resetSkeletonToOriginal.bind(this);
    //this.applyTransformToChildren = this.applyTransformToChildren.bind(this);
    // this.calculateDistance = this.calculateDistance.bind(this);
    //this.calculateAngle = this.calculateAngle.bind(this);
    //this.rotatePoint = this.rotatePoint.bind(this);
    // this.checkKeyframe = this.checkKeyframe.bind(this);
    this.readBones = this.readBones.bind(this);
    this.saveBones = this.saveBones.bind(this);
    // this.clearBones = this.clearBones.bind(this);
    //this.detectBoneClick = this.detectBoneClick.bind(this);
    //this.translateBone = this.translateBone.bind(this);
    //this.rotateBone = this.rotateBone.bind(this);

    this.onUpdate = options.onUpdate || function () { };
    this.vueInstance = options.vueInstance || null;
    this.glsInstance = options.glsInstance;
    this.selectedBone = options.selectedBone;
    this.skeletonIndices = options.skeletonIndices;
    this.isShiftPressed = options.isShiftPressed;
    this.parentBoneIndex = -1;
  }

  checkKeyframe() {
    console.log(" hi check key frame ... ", this.vueInstance.proxy.timeline);
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
  /*
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

  resetPoseToOriginal() {
    if (meshSkeleton) {
      // Reset all bones to their original positions and rotations
      meshSkeleton.bones.forEach(bone => {

        bone.resetPose();
        bone._markDirty();
      });

      // Update the entire skeleton
      meshSkeleton.update();


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
    //console.log(" hi all bones:", JSON.stringify(allBones.value));
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
  */
  calculateDistance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  }
  // 處理滑鼠按下事件
  handleMeshBoneCreateMouseDown(xNDC, yNDC, isShiftPressed) {
    if (isShiftPressed && lastSelectedBone.value) {
      // 使用最後選中骨骼的全域尾部位置作為新骨骼的起點
      const bone = lastSelectedBone.value;
      const tail = bone.getGlobalTail();
      mousedown_x = tail.x;
      mousedown_y = tail.y;
      mousemove_x = xNDC;
      mousemove_y = yNDC;
    }
    else {
      mousedown_x = xNDC;
      mousedown_y = yNDC;
    }
  }



  meshboneCreateMouseMove(xNDC, yNDC) {
    mousemove_x = xNDC;
    mousemove_y = yNDC;

  }

  meshBoneEditMouseMove(xNDC, yNDC) {
    if (lastSelectedBone.value && lastSelectedBonePart.value) {
      const bone = lastSelectedBone.value;

      if (lastSelectedBonePart.value === 'head') {
        if (bone.isConnected && bone.parent) {
          // When connected, moving head also moves parent's tail


          console.log("setting head ");
          bone.setGlobalHead(xNDC, yNDC);
          bone.parent.setGlobalTail(xNDC, yNDC);
        } else {
          // When disconnected, only move this bone's head
          bone.setGlobalHead(xNDC, yNDC);
        }
      } else if (lastSelectedBonePart.value === 'tail') {
        if (bone.isConnected && bone.children.length > 0) {
          // When connected, moving tail also moves children's heads

          console.log("setting tail ");
          bone.setGlobalTail(xNDC, yNDC);

          bone.children.forEach(child => {
            child.setGlobalHead(xNDC, yNDC);
          });
        } else {
          // Store original positions of disconnected children
          const childrenOriginalPositions = bone.children
            .filter(child => !child.isConnected)
            .map(child => ({
              bone: child,
              head: child.getGlobalHead(),
              tail: child.getGlobalTail(),
              rotation: child.globalRotation
            }));

          // Move the parent bone's tail
          bone.setGlobalTail(xNDC, yNDC);

          // Restore disconnected children's positions
          childrenOriginalPositions.forEach(({ bone: childBone, head, tail, rotation }) => {
            childBone.poseGlobalHead(head.x, head.y);
            childBone.length = Math.sqrt(
              Math.pow(tail.x - head.x, 2) +
              Math.pow(tail.y - head.y, 2)
            );
            childBone.globalRotation = rotation;
            if (childBone.parent) {
              childBone.localRotation = rotation - childBone.parent.globalRotation;
            } else {
              childBone.localRotation = rotation;
            }
            childBone._markDirty();
          });
        }
      } else if (lastSelectedBonePart.value === 'middle') {

        if (mousedown_x !== null && mousedown_y !== null) {
          const offsetX = lastSelectedBone.value.offsetX;
          const offsetY = lastSelectedBone.value.offsetY;

          // Store original positions of the bone
          const originalHead = bone.getGlobalHead();
          const originalTail = bone.getGlobalTail();

          // Store positions of connected children before moving
          const connectedChildrenPositions = bone.children
            .filter(child => child.isConnected)
            .map(child => ({
              bone: child,
              tail: child.getGlobalTail()
            }));

          // Move the bone
          bone.setGlobalHead(xNDC - offsetX, yNDC - offsetY);
          const deltaX = bone.getGlobalHead().x - originalHead.x;
          const deltaY = bone.getGlobalHead().y - originalHead.y;
          bone.setGlobalTail(originalTail.x + deltaX, originalTail.y + deltaY);

          // Update parent's tail if connected
          if (bone.isConnected && bone.parent) {
            bone.parent.setGlobalTail(bone.getGlobalHead().x, bone.getGlobalHead().y);
          }

          // Update connected children
          connectedChildrenPositions.forEach(({ bone: childBone, tail }) => {
            // Set child's head to parent's tail
            const parentTail = bone.getGlobalTail();
            childBone.setGlobalHead(parentTail.x, parentTail.y);
            // Adjust child's tail based on original offset
            const childLength = Math.sqrt(
              Math.pow(tail.x - childBone.getGlobalHead().x, 2) +
              Math.pow(tail.y - childBone.getGlobalHead().y, 2)
            );
            const angle = childBone.globalRotation;
            const newTailX = childBone.getGlobalHead().x + childLength * Math.cos(angle);
            const newTailY = childBone.getGlobalHead().y + childLength * Math.sin(angle);
            childBone.setGlobalTail(newTailX, newTailY);
            childBone._markDirty();


            // Restore child's tail to original position
            // childBone.poseGlobalTail(tail.x, tail.y);
          });

        }
      }
    }
  }


  GetMouseDragBone() {
    return { mousedown_x, mousedown_y, mousemove_x, mousemove_y };
  }

  GetHoverBone() {
    return mouseHoveringBone.value;
  }
  GetLastSelectedBone() {
    return lastSelectedBone.value;
  }
  calculateAngle(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
  }
  MeshBoneCreate(xNDC, yNDC) {
    //boneLenth= distance between (mousedown_x, mousedown_y) and (xNDC, yNDC)
    let boneLength = this.calculateDistance(mousedown_x, mousedown_y, xNDC, yNDC);

    if (boneLength < minBoneLength) {
      //console.log("Bone length too short, not creating bone.");
      return;
    }
    let angle = this.calculateAngle(mousedown_x, mousedown_y, xNDC, yNDC);
    //lastSelectedBone.value
    const newBone = meshSkeleton.addBone("", mousedown_x, mousedown_y, boneLength, angle, lastSelectedBone.value, true);
    //console.log("Created new bone:", newBone);

    lastSelectedBone.value = newBone;
    lastSelectedBonePart.value = 'tail'; // Since we created from head to tail
    //console.log(" last selected bone: ", JSON.stringify(lastSelectedBone.value));

    //then clean mouse position  as null
    mousedown_x = null;
    mousedown_y = null;
    mousemove_x = null;
    mousemove_y = null;

  }
  /*
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
  
  
    // a function to getting a cloest bone as hover bone:
  
  */
  GetCloestBoneAsHoverBone(xNDC, yNDC, isCreatMode = true) {
    const getBone = getClosestBoneAtClick(meshSkeleton, xNDC, yNDC, isCreatMode);

    mouseHoveringBone.value = getBone ? getBone.bone : null;

    return getBone;
  }

  GetCloestBoneAsSelectBone(xNDC, yNDC, isCreatMode = true) {
    const getBone = getClosestBoneAtClick(meshSkeleton, xNDC, yNDC, isCreatMode);

    lastSelectedBone.value = getBone ? getBone.bone : null;
    lastSelectedBonePart.value = getBone ? getBone.type : null; // 'head', 'tail', or 'middle'
    mousedown_x = xNDC;
    mousedown_y = yNDC;

    return getBone;
  }


  // 修改後的 handleBoneAnimateMouseDown
  handleMeshBoneAnimateMouseDown(xNDC, yNDC) {
    // console.log(" handleMeshBoneAnimateMouseDown at : ", xNDC, ' , ', yNDC);
    if (lastSelectedBone.value && lastSelectedBonePart.value) {
      const bone = lastSelectedBone.value;

      if (lastSelectedBonePart.value === 'head') {
        {
          // When connected, moving head also moves parent's tail
          bone.setPoseGlobalHead(xNDC, yNDC);
          //bone.parent.setGlobalTail(xNDC, yNDC);


        }
      } else if (lastSelectedBonePart.value === 'tail') {

        bone.setPoseGlobalTail(xNDC, yNDC);

      } else if (lastSelectedBonePart.value === 'middle') {


      }
    }
  }
  findBoneById(boneId) {
    for (const skeleton of skeletons) {
      for (const root of skeleton.rootBones) {
        const found = this.searchBoneRecursive(root, boneId);
        if (found) {
          lastSelectedBone.value = found;
          return found;
        }
      }
    }

    return null;
  }
  searchBoneRecursive(bone, boneId) {
    if (bone.id === boneId) {
      return bone;
    }
    if (bone.children) {
      for (const child of bone.children) {
        const found = this.searchBoneRecursive(child, boneId);
        if (found) return found;
      }
    }
    return null;
  }
  handleSelectPointsMouseDown(xNDC, yNDC) {
    mousedown_x = xNDC;
    mousedown_y = yNDC;
    mousemove_x = xNDC;
    mousemove_y = yNDC;
    console.log(" select points mouse down at : ", xNDC, ' , ', yNDC);
  }
  handleSelectPointsMouseMove(xNDC, yNDC) {

    mousemove_x = xNDC;
    mousemove_y = yNDC;
  }
  handleSelectPointsMouseUp(xNDC, yNDC, layerIndex, isShiftPressed = false, isCtrlPressed = false) {
  console.log(" handleSelectPointsMouseUp at : ", xNDC, ' , ', yNDC);

  // 框選範圍
  const minX = Math.min(mousedown_x, xNDC);
  const maxX = Math.max(mousedown_x, xNDC);
  const minY = Math.min(mousedown_y, yNDC);
  const maxY = Math.max(mousedown_y, yNDC);

  const vertices = this.glsInstance.layers[layerIndex].vertices.value;
  console.log(" vertices length: ", vertices.length);

  // 找出框到的點
  const newlySelected = [];
  for (let i = 0; i < vertices.length; i += 4) {
    const vx = vertices[i];     // x
    const vy = vertices[i + 1]; // y

    if (vx >= minX && vx <= maxX && vy >= minY && vy <= maxY) {
      newlySelected.push(i / 4); // push vertex index
    }
  }

  if (isCtrlPressed) {
    // Ctrl → 從選取中移除
    selectedVertices.value = selectedVertices.value.filter(idx => !newlySelected.includes(idx));
  } else if (isShiftPressed) {
    // Shift → 加入新的選取 (避免重複)
    const set = new Set(selectedVertices.value);
    for (let idx of newlySelected) set.add(idx);
    selectedVertices.value = Array.from(set);
  } else {
    // 沒有修飾鍵 → 重新選取
    selectedVertices.value = newlySelected;
  }

  console.log(" selected vertices: ", selectedVertices.value);

  // 清掉滑鼠狀態
  mousedown_x = null;
  mousedown_y = null;
  mousemove_x = null;
  mousemove_y = null;

  console.log(" select points mouse up at : ", xNDC, ' , ', yNDC);
}



  handleMeshBoneEditMouseDown(xNDC, yNDC) {
    const getBone = getClosestBoneAtClick(meshSkeleton, xNDC, yNDC);

    lastSelectedBone.value = getBone ? getBone.bone : null;
    lastSelectedBonePart.value = getBone ? getBone.type : null; // 'head', 'tail', or 'middle'
    mousedown_x = xNDC;
    mousedown_y = yNDC;

    return getBone;
  }
  handleBoneAnimateMouseDown(xNDC, yNDC) {
    const { selectedBoneIndex, boneEnd } = this.detectBoneClick(xNDC, yNDC, false);
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

  handleMeshBoneAnimateMouseMove(xNDC, yNDC) {
    const getBone = getClosestBoneAtClick(meshSkeleton, xNDC, yNDC, false);

    mouseHoveringBone.value = getBone ? getBone.bone : null;

    return getBone;
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
  Bones,
  meshSkeleton,
  skeletons,
  lastSelectedBone,
  selectedVertices
};