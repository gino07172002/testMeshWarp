// useBone.js
const { ref, reactive, toRaw } = Vue;
import glsInstance from './useWebGL.js';
import { getMouseLocalPos } from './useWebGL.js';
import { Bone as MeshBone, Vertex, Mesh2D, Skeleton, getClosestBoneAtClick, Attachment } from './mesh.js';
import {
  globalVars as v,
  forceUpdate
} from './globalVars.js';

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
var mousedown_NDC = null;
var mousemove_NDC = null;

// Mesh Bone State
const lastSelectedBone = ref();
const lastSelectedBonePart = ref(); // 'head', 'tail', or 'middle'
const selectedVertices = ref([]);
const mouseHoveringBone = ref();
const controlStatus = ref('none');

// Old Bone System State (Keep for compatibility)
const isEditingExistingBone = ref(false);
const selectedBoneForEditing = ref(-1);
const editingBoneEnd = ref(null);
const boneEndBeingDragged = ref(null);
const minBoneLength = 0.1;

// ==========================================
// 🧮 Math Utilities (提取數學邏輯)
// ==========================================
class BoneMath {
  static distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  static angle(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
  }

  // 2D 向量旋轉
  static rotateVector(x, y, cos, sin) {
    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos
    };
  }

  static ndcToPixel(val, size) {
    return (val + 1.0) * 0.5 * size;
  }

  static ndcToPixelInverseY(val, size) {
    return (1.0 - val) * 0.5 * size;
  }

  static pixelToNdc(val, size) {
    return (val / size) * 2.0 - 1.0;
  }

  static pixelToNdcInverseY(val, size) {
    return 1.0 - (val / size) * 2.0;
  }

  // 產生變換矩陣 (與 useWebGL transformMatrix 邏輯一致)
  static computeTransformMatrix(params) {
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
      sx * cosR,           sx * sinR * aspect,    0, 0,
      -sy * sinR / aspect, sy * cosR,             0, 0,
      0,                   0,                     1, 0,
      centerX,             centerY,               0, 1
    ]);
  }

  // 應用 4x4 矩陣到 vec4
  static applyMatrix(v, m) {
    const x = v[0], y = v[1], z = v[2], w = v[3];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12] * w,
      m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w
    ];
  }
}

class Bones {
  constructor(options = {}) {
    this.loadBones = this.loadBones.bind(this);
    this.saveBones = this.saveBones.bind(this);
    this.selectedBone = options.selectedBone;
  }

  // === 序列化與存檔 (保持原樣) ===
  serializeBone(bone) {
    if (!bone) return null;
    const children = Array.isArray(bone.children) ? bone.children : [];
    return {
      id: bone.id, name: bone.name, length: bone.length, isConnected: bone.isConnected,
      localHead: bone.localHead, localRotation: bone.localRotation,
      globalHead: bone.globalHead, globalRotation: bone.globalRotation,
      poseHead: bone.poseHead, poseRotation: bone.poseRotation, poseLength: bone.poseLength,
      children: children.map(child => this.serializeBone(child)).filter(c => c !== null)
    };
  }

  deserializeBone(data, parent = null) {
    const bone = new MeshBone(data.name, data.globalHead.x, data.globalHead.y, data.length, data.globalRotation, parent, data.isConnected);
    Object.assign(bone, {
      id: data.id, globalHead: data.globalHead, globalRotation: data.globalRotation,
      poseHead: data.poseHead, poseRotation: data.poseRotation, poseLength: data.poseLength
    });
    bone.children = Array.isArray(data.children) ? data.children.map(child => this.deserializeBone(child, bone)) : [];
    return bone;
  }

  saveBones() {
    try {
      if (!meshSkeleton?.bones || meshSkeleton.bones.length === 0) return;
      const serializedBones = meshSkeleton.bones.filter(bone => !bone.parent).map(bone => this.serializeBone(bone));
      const rawLayers = toRaw(glsInstance.layers);
      const vertexGroupObjects = rawLayers.map(layer => ({ name: layer.name.value, vertexGroup: toRaw(layer.vertexGroup.value) }));
      const allSaveData = { skeletons: serializedBones, selectedBoneId: this.selectedBone?.id || null, layers: vertexGroupObjects };
      localStorage.setItem('allSaveData', JSON.stringify(allSaveData));
      console.log('✅ Bones saved successfully');
    } catch (err) { console.error('❌ Error saving bones:', err); }
  }

  loadBones() {
    try {
      const saved = localStorage.getItem('allSaveData');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      const restoredRootBones = parsed.skeletons.map(data => this.deserializeBone(data, null));
      const allBones = restoredRootBones.flatMap(root => this.flattenBones(root));
      meshSkeleton.bones.splice(0, meshSkeleton.bones.length, ...allBones);
      meshSkeleton.updateRootBones();
      skeletons.splice(0, skeletons.length, meshSkeleton);
      this.selectedBone = this.findBoneByIdInSkeletons(allBones, parsed.selectedBoneId);
      glsInstance.layers.forEach((layer, i) => { if(parsed.layers[i]) layer.vertexGroup.value = parsed.layers[i].vertexGroup });
      console.log('✅ Bones loaded successfully');
    } catch (err) { console.error('❌ Error loading bones:', err); }
  }

  flattenBones(bone) { return [bone, ...(bone.children?.flatMap(child => this.flattenBones(child)) || [])]; }
  
  findBoneById(bone, id) { 
      if(arguments.length === 1) { id = bone; bone = skeletons[0]; } // Overload handle
      if (!bone || !id) return null;
      // Handle array of skeletons
      if (Array.isArray(bone)) {
          for(const b of bone) { const found = this.findBoneById(b, id); if(found) return found; }
          return null;
      }
      // Handle Skeleton object
      if (bone.rootBones) return this.findBoneById(bone.rootBones, id);
      
      if (bone.id === id) return bone;
      if (bone.children) {
          for (const child of bone.children) {
              const found = this.findBoneById(child, id);
              if (found) return found;
          }
      }
      return null;
  }
  
  findBoneByIdInSkeletons(allBones, id) { return allBones.find(b => b.id === id); }

  // === 骨骼創建邏輯 ===
  handleMeshBoneCreateMouseDown(xNDC, yNDC, isShiftPressed) {
    if (isShiftPressed && lastSelectedBone.value) {
      const tail = lastSelectedBone.value.getGlobalTail();
      mousedown_x = tail.x;
      mousedown_y = tail.y;
    } else {
      mousedown_x = xNDC;
      mousedown_y = yNDC;
    }
    mousemove_x = xNDC;
    mousemove_y = yNDC;
  }

  meshboneCreateMouseMove(xNDC, yNDC) {
    mousemove_x = xNDC;
    mousemove_y = yNDC;
  }

  MeshBoneCreate(xNDC, yNDC) {
    let boneLength = BoneMath.distance(mousedown_x, mousedown_y, xNDC, yNDC);
    if (boneLength < minBoneLength) return;

    let angle = BoneMath.angle(mousedown_x, mousedown_y, xNDC, yNDC);
    const newBone = meshSkeleton.addBone("", mousedown_x, mousedown_y, boneLength, angle, lastSelectedBone.value, true);

    lastSelectedBone.value = newBone;
    lastSelectedBonePart.value = 'tail';
    mousedown_x = null; mousedown_y = null; mousemove_x = null; mousemove_y = null;
  }

  // === 骨骼編輯邏輯 (重構拆分) ===
  
  _moveBoneHead(bone, x, y) {
    if (bone.isConnected && bone.parent) {
      bone.setGlobalHead(x, y);
      bone.parent.setGlobalTail(x, y);
    } else {
      bone.setGlobalHead(x, y);
    }
  }

  _moveBoneTail(bone, x, y) {
    if (bone.isConnected && bone.children.length > 0) {
      bone.setGlobalTail(x, y);
      bone.children.forEach(child => child.setGlobalHead(x, y));
    } else {
      // 處理斷開連接的子骨骼
      const childrenState = bone.children
        .filter(child => !child.isConnected)
        .map(child => ({ bone: child, head: child.getGlobalHead(), rotation: child.globalRotation }));

      bone.setGlobalTail(x, y);

      childrenState.forEach(({ bone: child, head }) => {
        child.setGlobalHead(head.x, head.y);
        child._markDirty();
      });
    }
  }

  _moveBoneWhole(bone, x, y, offsetX, offsetY) {
    const originalHead = bone.getGlobalHead();
    const originalTail = bone.getGlobalTail();
    const connectedChildren = bone.children
      .filter(child => child.isConnected)
      .map(child => ({ bone: child, tail: child.getGlobalTail() }));

    bone.setGlobalHead(x - offsetX, y - offsetY);
    
    const deltaX = bone.getGlobalHead().x - originalHead.x;
    const deltaY = bone.getGlobalHead().y - originalHead.y;
    
    bone.setGlobalTail(originalTail.x + deltaX, originalTail.y + deltaY);

    if (bone.isConnected && bone.parent) {
      bone.parent.setGlobalTail(bone.getGlobalHead().x, bone.getGlobalHead().y);
    }

    connectedChildren.forEach(({ bone: child, tail }) => {
      const parentTail = bone.getGlobalTail();
      child.setGlobalHead(parentTail.x, parentTail.y);
      // 維持子骨骼長度與角度
      const len = BoneMath.distance(child.getGlobalHead().x, child.getGlobalHead().y, tail.x, tail.y);
      const angle = child.globalRotation; // 使用舊角度
      const newTailX = child.getGlobalHead().x + len * Math.cos(angle);
      const newTailY = child.getGlobalHead().y + len * Math.sin(angle);
      child.setGlobalTail(newTailX, newTailY);
      child._markDirty();
    });
  }

  meshBoneEditMouseMove(xNDC, yNDC) {
    if (!lastSelectedBone.value || !lastSelectedBonePart.value) return;
    const bone = lastSelectedBone.value;
    const part = lastSelectedBonePart.value;

    if (part === 'head') this._moveBoneHead(bone, xNDC, yNDC);
    else if (part === 'tail') this._moveBoneTail(bone, xNDC, yNDC);
    else if (part === 'middle') {
      if (mousedown_x !== null && mousedown_y !== null) {
        this._moveBoneWhole(bone, xNDC, yNDC, bone.offsetX, bone.offsetY);
      }
    }
  }

  // === Animation Logic ===
  handleMeshBoneAnimateMouseDown(x, y) {
    if (!lastSelectedBone.value || !lastSelectedBonePart.value) return;
    const bone = lastSelectedBone.value;
    const part = lastSelectedBonePart.value;

    if (part === 'head') bone.setPoseGlobalHead(x, y);
    else if (part === 'tail') bone.setPoseGlobalTail(x, y);
  }

  // === Getters ===
  GetMouseDragBone() { return { mousedown_x, mousedown_y, mousemove_x, mousemove_y }; }
  GetHoverBone() { return mouseHoveringBone.value; }
  GetLastSelectedBone() { return lastSelectedBone.value; }
  
  GetCloestBoneAsHoverBone(xNDC, yNDC, isCreatMode = true) {
    const getBone = getClosestBoneAtClick(meshSkeleton, xNDC, yNDC, isCreatMode);
    mouseHoveringBone.value = getBone ? getBone.bone : null;
    return getBone;
  }

  GetCloestBoneAsSelectBone(x, y, isCreatMode = true) {
    const getBone = getClosestBoneAtClick(meshSkeleton, x, y, isCreatMode);
    lastSelectedBone.value = getBone ? getBone.bone : null;
    lastSelectedBonePart.value = getBone ? getBone.type : null;
    mousedown_x = x; mousedown_y = y;
    return getBone;
  }

  handleMeshBoneEditMouseDown(xNDC, yNDC) {
    const getBone = getClosestBoneAtClick(meshSkeleton, xNDC, yNDC);
    lastSelectedBone.value = getBone ? getBone.bone : null;
    lastSelectedBonePart.value = getBone ? getBone.type : null;
    mousedown_x = xNDC; mousedown_y = yNDC;
    return getBone;
  }

  // === Select Points Logic ===
  handleSelectPointsMouseDown(xNDC, yNDC, x, y) {
    mousedown_x = x; mousedown_y = y;
    mousemove_x = x; mousemove_y = y;
    mousedown_NDC = { x: xNDC, y: yNDC };
    mousemove_NDC = { x: xNDC, y: yNDC };
  }

  handleSelectPointsMouseMove(xNDC, yNDC, x, y) {
    mousemove_NDC = { x: xNDC, y: yNDC };
    mousemove_x = x; mousemove_y = y;
  }

  handleSelectPointsMouseUp(xNDC, yNDC, layerIndex, isShiftPressed = false, isCtrlPressed = false) {
    const minX = Math.min(mousedown_NDC.x, xNDC);
    const maxX = Math.max(mousedown_NDC.x, xNDC);
    const minY = Math.min(mousedown_NDC.y, yNDC);
    const maxY = Math.max(mousedown_NDC.y, yNDC);

    const layer = glsInstance.layers[layerIndex];
    if(!layer) return;
    const vertices = layer.vertices.value;
    const params = layer.poseTransformParams || layer.transformParams;

    const transformMatrix = BoneMath.computeTransformMatrix(params);

    const newlySelected = [];
    for (let i = 0; i < vertices.length; i += 4) {
      const localVert = [vertices[i], vertices[i + 1], vertices[i + 2] || 0, vertices[i + 3] || 1];
      const ndc = BoneMath.applyMatrix(localVert, transformMatrix);
      
      if (ndc[0] >= minX && ndc[0] <= maxX && ndc[1] >= minY && ndc[1] <= maxY) {
        newlySelected.push(i / 4);
      }
    }

    if (isCtrlPressed) {
      selectedVertices.value = selectedVertices.value.filter(idx => !newlySelected.includes(idx));
    } else if (isShiftPressed) {
      const set = new Set(selectedVertices.value);
      for (let idx of newlySelected) set.add(idx);
      selectedVertices.value = Array.from(set);
    } else {
      selectedVertices.value = newlySelected;
    }
    mousedown_x = null; mousedown_y = null; mousemove_x = null; mousemove_y = null;
  }

  // === Move Vertex ===
  moveSelectedVertex(currentChosedLayer, useMultiSelect, localSelectedVertex, gl, xNDC, yNDC, dragStartX, dragStartY) {
    const layer = glsInstance.layers[currentChosedLayer.value];
    if(!layer) return;
    const vertices = layer.vertices.value;

    if (!layer.originalVertices) layer.originalVertices = [...vertices];

    const currLocal = getMouseLocalPos(xNDC, yNDC, layer);

    if (!useMultiSelect && localSelectedVertex !== -1) {
      const index = localSelectedVertex * 4;
      vertices[index] = currLocal.x;
      vertices[index + 1] = currLocal.y;
    } else if (useMultiSelect && selectedVertices.value.length > 0) {
      const startLocal = getMouseLocalPos(dragStartX, dragStartY, layer);
      const dxLocal = currLocal.x - startLocal.x;
      const dyLocal = currLocal.y - startLocal.y;

      for (let idx of selectedVertices.value) {
        const index = idx * 4;
        vertices[index] += dxLocal;
        vertices[index + 1] += dyLocal;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  }

  // === 🦴 核心變形邏輯 🦴 ===
  
  // ✨ 新增：強制更新骨架階層 Pose
  // 這確保了當父骨骼移動時，子骨骼的 poseGlobalHead 也會更新
  updateSkeletonPose() {
    const updateRecursive = (bone) => {
        // 如果有父骨骼，updatePoseGlobalTransform 會依賴父骨骼的 Pose 計算自己的 Pose
        bone.updatePoseGlobalTransform();
        bone.children.forEach(child => updateRecursive(child));
    };
    meshSkeleton.rootBones.forEach(root => updateRecursive(root));
  }

  updatePoseMesh(gl) {
    const layers = glsInstance.layers;
    if (!meshSkeleton || meshSkeleton.rootBones.length === 0) return;

    // 🔥 1. 先更新整個骨架的 Pose 階層
    this.updateSkeletonPose();

    const boneMap = {};
    const collectBones = (bone) => {
      boneMap[bone.name] = bone;
      bone.children.forEach(collectBones);
    };
    meshSkeleton.rootBones.forEach(collectBones);

    // 變形運算核心
    const deformVertex = (vx, vy, vz, vw, bone, weight, width, height, top, left) => {
      const poseTransform = bone.getGlobalPoseTransform();
      const originalHead = bone.getGlobalHead(); // Bind Pose
      const rotationDelta = poseTransform.rotation - bone.globalRotation;
      
      const cosR = Math.cos(rotationDelta);
      const sinR = Math.sin(rotationDelta);

      // NDC -> Pixel
      const vxLayerPixel = BoneMath.ndcToPixel(vx, width);
      const vyLayerPixel = BoneMath.ndcToPixelInverseY(vy, height);

      // 向量: Vertex -> BoneHead (在原始 Bind Pose 下)
      const lx = (vxLayerPixel + left) - originalHead.x;
      const ly = (vyLayerPixel + top) - originalHead.y;

      // 旋轉
      const rotated = BoneMath.rotateVector(lx, ly, cosR, sinR);

      // 新位置 = 新的 BoneHead + 旋轉後的向量
      const pxCanvas = rotated.x + poseTransform.head.x;
      const pyCanvas = rotated.y + poseTransform.head.y;

      // Pixel -> NDC
      const pxNDC = BoneMath.pixelToNdc(pxCanvas - left, width);
      const pyNDC = BoneMath.pixelToNdcInverseY(pyCanvas - top, height);

      return { x: pxNDC * weight, y: pyNDC * weight, z: vz * weight, w: vw * weight };
    };

    for (const layer of layers) {
      const vertices = layer.vertices.value;
      if (!vertices || vertices.length === 0) continue;

      const vertexGroups = layer.vertexGroup.value;
      const newVertices = new Float32Array(vertices.length);
      
      // 注意：這裡不需要先 set(vertices)，因為我們會重算所有有權重的點
      // 如果沒有 vertexGroups，則直接複製 (保持你原本的邏輯)
      if (!vertexGroups || vertexGroups.length === 0) {
        newVertices.set(vertices);
        layer.poseVertices.value = newVertices;
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, newVertices, gl.STATIC_DRAW);
        continue;
      }

      const { width, height, top, left } = layer.transformParams;
      
      // 建立一個 map 來暫存每個頂點受到哪些骨頭影響
      // 結構: vertexIndex -> [{ bone, weight }, ...]
      const vertexInfluenceMap = new Map();

      // 1. 第一步：收集所有影響 (原本的寫法會重複遍歷，這裡改為以頂點為中心思考)
      for (const group of vertexGroups) {
        const bone = boneMap[group.name];
        if (!bone || !group.vertices) continue;

        for (const v of group.vertices) {
          if (!vertexInfluenceMap.has(v.id)) {
            vertexInfluenceMap.set(v.id, []);
          }
          vertexInfluenceMap.get(v.id).push({ bone, weight: v.weight });
        }
      }

      // 2. 第二步：遍歷所有頂點進行計算
      // 這裡直接遍歷 vertices 陣列，確保沒被影響的點也能被處理
      const vertexCount = vertices.length / 4;
      
      for (let i = 0; i < vertexCount; i++) {
        const idx = i * 4;
        const influences = vertexInfluenceMap.get(i);

        if (!influences || influences.length === 0) {
          // Case A: 完全沒有權重的頂點 -> 保持在原地 (Bind Pose)
          newVertices[idx] = vertices[idx];
          newVertices[idx + 1] = vertices[idx + 1];
          newVertices[idx + 2] = vertices[idx + 2];
          newVertices[idx + 3] = vertices[idx + 3];
          continue;
        }

        // Case B: 有權重的頂點 -> 進行正規化混合
        let totalWeight = 0;
        for (const inf of influences) totalWeight += inf.weight;

        // 計算縮放因子 (Normalization Scale)
        // 如果總權重是 0.6，scale 就是 1/0.6 = 1.666...，這樣乘回去總和就是 1.0
        const scale = totalWeight > 0 ? 1.0 / totalWeight : 0;

        let accX = 0, accY = 0, accZ = 0, accW = 0;

        for (const inf of influences) {
          const normalizedWeight = inf.weight * scale;

          // 呼叫變形計算 (你的 deformVertex 函式)
          const d = deformVertex(
            vertices[idx], vertices[idx + 1], vertices[idx + 2], vertices[idx + 3],
            inf.bone, 
            normalizedWeight, // ✨ 傳入正規化後的權重
            width, height, top, left
          );

          accX += d.x;
          accY += d.y;
          accZ += d.z;
          accW += d.w;
        }

        newVertices[idx] = accX;
        newVertices[idx + 1] = accY;
        newVertices[idx + 2] = accZ;
        newVertices[idx + 3] = accW;
      }

      layer.poseVertices.value = newVertices;
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, newVertices, gl.STATIC_DRAW);
    }
  }

  updateSlotAttachments() {
    skeletons.forEach(skeleton => {
      skeleton.forEachBone(bone => {
        if (!bone.slots || bone.slots.length === 0) return;

        const bonePose = bone.getGlobalPoseTransform();
        const boneRest = bone.getGlobalTransform();

        bone.slots.forEach(slot => {
          const attachmentName = slot.attachmentKey;
          if (!attachmentName) return;

          const attachment = slot.attachments[attachmentName];
          if (!attachment) return;

          const layerId = attachment.refId;
          const layer = glsInstance.layers[layerId];

          // =========================================================
          // 🔥 修正開始：檢查是否為蒙皮網格 (Skinned Mesh)
          // =========================================================
          
          // 檢查該圖層是否有綁定權重
          const hasWeights = layer.vertexGroup && 
                             layer.vertexGroup.value && 
                             layer.vertexGroup.value.length > 0;

          // 如果有權重 (代表是 Mesh)，則不應該再進行 Slot 的整體位移
          // 我們只更新可見性，然後直接跳過 Transform 計算
          if (hasWeights) {
            layer.visible = slot.visible;
            if (slot.color) layer.opacity = { value: slot.color.a };
            
            // 重要：清除 poseTransformParams，確保它使用原始的 transformParams (靜態位置)
            layer.poseTransformParams = null; 
            return; 
          }

          // =========================================================
          // 🔥 修正結束 (以下保持原本的 Slot 移動邏輯)
          // =========================================================

          if (layer && layer.transformParams) {
            const { left, top, width, height, canvasWidth, canvasHeight } = layer.transformParams;
            const originalRotation = layer.transformParams.rotation || 0;

            const originalCenter = { x: left + width / 2, y: top + height / 2 };
            // ... (原本的旋轉計算代碼保持不變) ...
            const rotationDelta = bonePose.rotation - boneRest.rotation;
            
            const cos = Math.cos(rotationDelta);
            const sin = Math.sin(rotationDelta);

            // Vector from Bone Head -> Layer Center
            const vecX = originalCenter.x - boneRest.head.x;
            const vecY = originalCenter.y - boneRest.head.y;

            // Rotate vector using helper
            // 注意：如果你已經整合了 BoneMath，這裡可以用 BoneMath.rotateVector
            const rotatedX = vecX * cos - vecY * sin;
            const rotatedY = vecX * sin + vecY * cos;

            const newCenterX = bonePose.head.x + rotatedX;
            const newCenterY = bonePose.head.y + rotatedY;
            const newRotation = originalRotation - rotationDelta;

            layer.poseTransformParams = {
              left: newCenterX - width / 2,
              top: newCenterY - height / 2,
              right: (newCenterX - width / 2) + width,
              bottom: (newCenterY - height / 2) + height,
              width, 
              height, 
              rotation: newRotation, 
              canvasWidth, 
              canvasHeight,
              debugPivot: { x: bonePose.head.x, y: bonePose.head.y }
            };

            layer.visible = slot.visible;
            if (slot.color) layer.opacity = { value: slot.color.a };
          }
        });
      });
    });
  }

  recoverSelectedVertex(currentChosedLayer) {
    const layer = glsInstance.layers[currentChosedLayer.value];
    if (!layer.originalVertices) return;
    const vertices = layer.vertices.value;
    const original = layer.originalVertices;

    for (let idx of selectedVertices.value) {
      const i = idx * 4;
      vertices[i] = original[i];
      vertices[i + 1] = original[i + 1];
      vertices[i + 2] = original[i + 2];
      vertices[i + 3] = original[i + 3];
    }
    layer.vertices.value = new Float32Array(vertices);
    forceUpdate();
  }
}

export {
  skeletonVertices, skeletonVerticesLast, originalSkeletonVertices, boneParents, boneChildren,
  isEditingExistingBone, selectedBoneForEditing, editingBoneEnd, boneEndBeingDragged,
  Bones, meshSkeleton, skeletons, lastSelectedBone, selectedVertices
};
export const bonesInstance = new Bones();