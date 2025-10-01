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

const originalSkeletonVertices = ref([]);
const boneParents = ref([]);
const boneChildren = ref([]);
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

    };
    localStorage.setItem('boneData', JSON.stringify(boneData));
  }

  // 📥 載入骨架
  readBones() {
    const boneDataStr = localStorage.getItem('boneData');
    if (boneDataStr) {

    }
  }

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
  handleMeshBoneAnimateMouseMove(xNDC, yNDC) {
    const getBone = getClosestBoneAtClick(meshSkeleton, xNDC, yNDC, false);

    mouseHoveringBone.value = getBone ? getBone.bone : null;

    return getBone;
  }


  moveSelectedVertex(currentChosedLayer, useMultiSelect, localSelectedVertex, gl, xNDC, yNDC, dragStartX, dragStartY) {
    const vertices = glsInstance.layers[currentChosedLayer.value].vertices.value;

    if (!useMultiSelect && localSelectedVertex !== -1) {
      // ===== 單點移動 =====
      const index = localSelectedVertex * 4;
      vertices[index] = xNDC;
      vertices[index + 1] = yNDC;

    } else if (useMultiSelect && selectedVertices.value.length > 0) {
      console.log(" in multi select move ... ");
      // ===== 群組移動 =====
      const dx = xNDC - dragStartX;
      const dy = yNDC - dragStartY;

      for (let idx of selectedVertices.value) {
        const index = idx * 4;
        vertices[index] += dx;
        vertices[index + 1] += dy;
      }


    }

    // 更新 VBO
    gl.bindBuffer(gl.ARRAY_BUFFER, glsInstance.layers[currentChosedLayer.value].vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);


  }
  updatePoseMesh(gl) {
    console.log(" update pose mesh ... ");
    /*
    //consider bone's pose and vertex group's weight to update mesh vertices

    //1.get all layers
    const layers = this.glsInstance.layers;
    //2.get all bones
    const bones = meshSkeleton.bones;
    //3. get all vertices and caculate total weight of bone for each vertex from vertex group
    //layer has vertex group which has bone index and weight
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex];
      const vertices = layer.vertices.value;
      const vertexGroups = layer.vertexGroup.value; // array of {boneIndex, weight} for each vertex
      if (!vertexGroups || vertexGroups.length === 0) continue;
      const newVertices = new Float32Array(vertices.length);

      for (let i = 0; i < vertices.length; i += 4) {
        const vx = vertices[i];     // x
        const vy = vertices[i + 1]; // y
        const vz = vertices[i + 2]; // z
        const vw = vertices[i + 3]; // w
        const vertexIndex = i / 4;
        const groups = vertexGroups[vertexIndex]; // array of {boneIndex, weight}

        if (!groups || groups.length === 0) {
          newVertices[i] = vx;
          newVertices[i + 1] = vy;
          newVertices[i + 2] = vz;
          newVertices[i + 3] = vw;
          continue;
        }
        console.log(" vertex ", vertexIndex, " groups: ", groups);

        let newX = 0;
        let newY = 0;
        let totalWeight = 0;
        for (let j = 0; j < groups.length; j++) {
          const { boneIndex, weight } = groups[j];
          const bone = bones.find(b => b.id === boneIndex);
          if (bone) {

            const head = bone.getGlobalHead();
            const tail = bone.getGlobalTail();
            const angle = bone.globalRotation;
            const length = bone.length;
            // calculate the new position of the vertex based on bone's head, tail, angle and length
            const projectedLength = ((vx - head.x) * Math.cos(angle) + (vy - head.y) * Math.sin(angle));
            const clampedLength = Math.max(0, Math.min(length, projectedLength));
            const boneX = head.x + clampedLength * Math.cos(angle);
            const boneY = head.y + clampedLength * Math.sin(angle);
            newX += boneX * weight;
            newY += boneY * weight;
            totalWeight += weight;
          }
        }
        if (totalWeight > 0) {
          newX /= totalWeight;
          newY /= totalWeight;
          newX = 1;
          newY = 1;
          newVertices[i] = newX;

          newVertices[i + 1] = newY;
          newVertices[i + 2] = vz;
          newVertices[i + 3] = vw;
        }
        else {
          newVertices[i] = vx;
          newVertices[i + 1] = vy;
          newVertices[i + 2] = vz;
          newVertices[i + 3] = vw;
        }
      }
      //layer.poseVertices.value = newVertices;
      layer.vertices.value = newVertices;

      //bind to webgl buffer
      console.log(" update layer ", layerIndex, " with new vertices: ", newVertices[0]);
      // gl.bindBuffer(gl.ARRAY_BUFFER, glsInstance.layers[layerIndex].vbo);
      //  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(newVertices), gl.STATIC_DRAW);
*/

    //simple test : just move all vertices  with root bone's head position
  const layers = this.glsInstance.layers;
const rootBones = meshSkeleton.rootBones;
if (rootBones.length === 0) return;

const rootBone = rootBones[0];
const poseTransform = rootBone.getGlobalPoseTransform();

const head = poseTransform.head;              
const originalHead = rootBone.getGlobalHead(); 

// 計算旋轉差值
const rotationDelta = poseTransform.rotation - rootBone.globalRotation;
const cosR = Math.cos(rotationDelta);
const sinR = Math.sin(rotationDelta);

// 計算縮放比例 (只影響骨骼軸向正方向)
const scale = rootBone.length > 1e-6
  ? poseTransform.length / rootBone.length
  : 1.0;

// 原始骨骼方向 (用 globalRotation)
const dirX = Math.cos(rootBone.globalRotation);
const dirY = Math.sin(rootBone.globalRotation);

console.log("root bone head:", head, "rotationDelta:", rotationDelta, "scale:", scale);

for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
  const layer = layers[layerIndex];
  const vertices = layer.vertices.value;
  if (!vertices || vertices.length === 0) continue;

  const newVertices = new Float32Array(vertices.length);

  for (let i = 0; i < vertices.length; i += 4) {
    const vx = vertices[i];     
    const vy = vertices[i + 1]; 
    const vz = vertices[i + 2]; 
    const vw = vertices[i + 3]; 

    // step1: local (以原始 head 為中心)
    const lx = vx - originalHead.x;
    const ly = vy - originalHead.y;

    // step2: 投影到骨骼軸向
    const along = lx * dirX + ly * dirY;

    // step3: 法線方向 (垂直於骨骼)
    const perpX = lx - along * dirX;
    const perpY = ly - along * dirY;

    let sx, sy;

    if (along >= 0) {
      // head → tail 方向，做縮放
      const scaledAlong = along * scale;
      sx = scaledAlong * dirX + perpX;
      sy = scaledAlong * dirY + perpY;
    } else {
      // head → 反方向，不縮放
      sx = along * dirX + perpX;
      sy = along * dirY + perpY;
    }

    // step4: 再做旋轉差值 (poseRotation - globalRotation)
    const rx = sx * cosR - sy * sinR;
    const ry = sx * sinR + sy * cosR;

    // step5: 移回 pose head
    newVertices[i]     = rx + head.x;
    newVertices[i + 1] = ry + head.y;
    newVertices[i + 2] = vz;
    newVertices[i + 3] = vw;
  }

  layer.poseVertices.value = newVertices;

  gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, newVertices, gl.STATIC_DRAW);
}



  }

}

// ✅ 匯出
export {
  skeletonVertices,
  skeletonVerticesLast,
  originalSkeletonVertices,
  boneParents,
  boneChildren,
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