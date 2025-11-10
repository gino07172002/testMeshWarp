const { ref, reactive, toRaw } = Vue;
import glsInstance from './useWebGL.js';
import { Bone as MeshBone, Vertex, Mesh2D, Skeleton, getClosestBoneAtClick, Attachment } from './mesh.js';
import {
  globalVars as v,
  triggerRefresh,
  loadHtmlPage,
  convertToNDC,
  selectedLayers,
  mousePressed,
  isShiftPressed,
  forceUpdate,
  initGlAlready,
  wholeImageWidth,
  wholeImageHeight,
  lastLoadedImageType,
  meshs
} from './globalVars.js'  // 引入全局變數
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



class Bones {
  constructor(options = {}) {

    this.loadBones = this.loadBones.bind(this);
    this.saveBones = this.saveBones.bind(this);

    this.selectedBone = options.selectedBone;

    this.parentBoneIndex = -1;
  }

  checkKeyframe() {
    console.log(" hi check key frame ... ", this.vueInstance.proxy.timeline);
  }

  // 💾 儲存骨架
  // 💾 儲存骨架
  serializeBone(bone) {
    if (!bone) return null;
    const children = Array.isArray(bone.children) ? bone.children : [];

    return {
      id: bone.id,
      name: bone.name,
      length: bone.length,
      isConnected: bone.isConnected,
      localHead: bone.localHead,
      localRotation: bone.localRotation,
      globalHead: bone.globalHead,
      globalRotation: bone.globalRotation,
      poseHead: bone.poseHead,
      poseRotation: bone.poseRotation,
      poseLength: bone.poseLength,
      children: children
        .map(child => this.serializeBone(child))
        .filter(c => c !== null)
    };
  }

  // 🔁 兩階段反序列化
  deserializeBone(data, parent = null) {
    // === 第一階段：建立骨頭 ===
    const bone = new MeshBone(
      data.name,
      data.globalHead.x,
      data.globalHead.y,
      data.length,
      data.globalRotation,
      parent, // 直接設定 parent
      data.isConnected
    );
    bone.id = data.id;
    bone.globalHead = data.globalHead;
    bone.globalRotation = data.globalRotation;
    bone.poseHead = data.poseHead;
    bone.poseRotation = data.poseRotation;
    bone.poseLength = data.poseLength;

    // === 第二階段：遞迴建立子骨頭 ===
    bone.children = Array.isArray(data.children)
      ? data.children.map(childData => this.deserializeBone(childData, bone))
      : [];

    return bone;
  }

  // 💾 儲存所有骨架
  saveBones() {
    try {
      if (!meshSkeleton?.bones || meshSkeleton.bones.length === 0) {
        console.warn('⚠️ No bones found in meshSkeleton.');
        return;
      }

      // 只序列化 root bones
      const serializedBones = meshSkeleton.bones
        .filter(bone => !bone.parent)
        .map(bone => this.serializeBone(bone));

      const deepCopy = (obj) => {
        if (obj === undefined || obj === null) return obj;
        try {
          return JSON.parse(JSON.stringify(toRaw(obj)));
        } catch (e) {
          console.warn("deepCopy failed on:", obj, e);
          return null;
        }
      };

      const rawLayers = toRaw(glsInstance.layers);


      const vertexGroupObjects = rawLayers.map(layer => ({
        name: layer.name.value,
        vertexGroup: toRaw(layer.vertexGroup.value)
      })
      );
      console.log(" vertex group objects: ", JSON.stringify(vertexGroupObjects));

      const allSaveData = {
        skeletons: serializedBones,
        selectedBoneId: this.selectedBone?.id || null,

        layers: vertexGroupObjects
      };

      console.log("checking all save data: ", JSON.stringify(allSaveData));
      localStorage.setItem('allSaveData', JSON.stringify(allSaveData));
      console.log('✅ Bones saved successfully');
    } catch (err) {
      console.error('❌ Error saving bones:', err);
    }
  }

  // 🔁 載入所有骨架
  loadBones() {
    try {
      const saved = localStorage.getItem('allSaveData');
      if (!saved) {
        console.warn('⚠️ No saved bones found in localStorage.');
        return;
      }

      const parsed = JSON.parse(saved);

      // 🦴 反序列化所有 root bones
      const restoredRootBones = parsed.skeletons.map(data =>
        this.deserializeBone(data, null)
      );

      // ✅ 一次展開所有 bones
      const allBones = restoredRootBones.flatMap(root => this.flattenBones(root));

      // ✅ 重設 meshSkeleton 的 bones
      meshSkeleton.bones.splice(0, meshSkeleton.bones.length, ...allBones);
      meshSkeleton.updateRootBones();

      // ✅ 重設 skeletons 陣列
      skeletons.splice(0, skeletons.length, meshSkeleton);

      // ✅ 還原選中與索引
      this.selectedBone = this.findBoneByIdInSkeletons(allBones, parsed.selectedBoneId);

      console.log('glsInstance:', glsInstance);
      console.log('glsInstance.layers:', glsInstance.layers);
      console.log('glsInstance.layers.value:', glsInstance.layers?.value);
      console.log('parsed:', parsed);
      console.log(" hello vertex group objects: ", parsed.layers);
      glsInstance.layers.forEach((layer, i) => {
        layer.vertexGroup.value = parsed.layers[i]?.vertexGroup
      })


      // console.log("hi layer vertex group: ", JSON.stringify(this.glsInstance.layers));
      console.log('✅ Bones loaded successfully');
    } catch (err) {
      console.error('❌ Error loading bones:', err);
    }
  }

  // ✅ 展開骨架樹（不重複）
  flattenBones(bone) {
    return [bone, ...(bone.children?.flatMap(child => this.flattenBones(child)) || [])];
  }


  // 🧭 遞迴搜尋 bone（跨多個 skeleton）
  findBoneById(bone, id) {
    console.log("bone?", bone, "id?", id, "this?", this);
    if (!bone || !id) return null;
    if (bone.id === id) return bone;
    for (const child of bone.children) {
      const found = this.findBoneById(child, id);
      if (found) return found;
    }
    return null;
  }

  // 🔍 在整個 skeletons 陣列裡找某個 bone
  findBoneByIdInSkeletons(skeletons, id) {
    if (!id) return null;
    for (const root of skeletons) {
      const found = this.findBoneById(root, id);
      if (found) return found;
    }
    return null;
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
      console.log(" found bone: ", bone.id, " bone name ", bone.name);
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

    const vertices = glsInstance.layers[layerIndex].vertices.value;
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

    //backup original vertices (if backup not exist)
    if (!glsInstance.layers[currentChosedLayer.value].originalVertices) {
      glsInstance.layers[currentChosedLayer.value].originalVertices = [...vertices];
    }


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

    //simple test : just move all vertices  with root bone's head position , maybe would be more complex later
    const layers = glsInstance.layers;
    if (!meshSkeleton || meshSkeleton.rootBones.length === 0) return;

    // === 預先建立一個骨頭名稱對應表 ===
    const boneMap = {};
    function collectBones(bone) {
      boneMap[bone.name] = bone;
      if (bone.children) {
        for (const child of bone.children) {
          collectBones(child);
        }
      }
    }
    for (const rootBone of meshSkeleton.rootBones) {
      collectBones(rootBone);
    }
/* somehow correct rotation
function deformVertexByBone(vx, vy, vz, vw, bone, weight, width, height, canvasWidth, canvasHeight, top, left) {
    // ----------------------------------------------------
    // 1. 計算變形所需的參數 (與原始碼相同)
    // ----------------------------------------------------
    const poseTransform = bone.getGlobalPoseTransform();
    const head = poseTransform.head;
    const originalHead = bone.getGlobalHead();
    const rotationDelta = poseTransform.rotation - bone.globalRotation;
    const cosR = Math.cos(rotationDelta);
    const sinR = Math.sin(rotationDelta);
    const scale = bone.length > 1e-6
        ? poseTransform.length / bone.length
        : 1.0;
    const dirX = Math.cos(bone.globalRotation);
    const dirY = Math.sin(bone.globalRotation);

    // ----------------------------------------------------
    // 2. [!! 修正 !!] 將頂點從 ROI 座標轉換到 Canvas 座標
    // ----------------------------------------------------
    // 假設 ROI(0,0) 對應 Canvas(0,0) 並縮放。
    // (注意：這裡暫時忽略了 top/left，請見下方說明)
    const vcx = vx * (canvasWidth / width);
    const vcy = vy * (canvasHeight / height);

    // ----------------------------------------------------
    // 3. [!! 修正 !!] 在 Canvas 座標系中，計算到綁定頭部的相對向量
    // ----------------------------------------------------
    // (VertexInCanvas) - (BindHeadInCanvas)
    // 這才是頂點相對於「旋轉中心」的真正向量
    const lx = vcx - originalHead.x;
    const ly = vcy - originalHead.y;

    // ----------------------------------------------------
    // 4. 應用軸向縮放 (現在 lx, ly 是在一致的 Canvas 座標系中)
    // ----------------------------------------------------
    const along = lx * dirX + ly * dirY;
    const perpX = lx - along * dirX;
    const perpY = ly - along * dirY;

    const scaledAlongX = along * scale * dirX;
    const scaledAlongY = along * scale * dirY;

    const sx = scaledAlongX + perpX;
    const sy = scaledAlongY + perpY;

    // ----------------------------------------------------
    // 5. 應用旋轉差值 (在 Canvas 座標系中)
    // ----------------------------------------------------
    const rx = sx * cosR - sy * sinR;
    const ry = sx * sinR + sy * cosR;

    // ----------------------------------------------------
    // 6. [!! 修正 !!] 轉換回世界空間 (在 Canvas 座標系中)
    // ----------------------------------------------------
    // (RotatedVectorInCanvas) + (PoseHeadInCanvas)
    const pcx = rx + head.x;
    const pcy = ry + head.y;

    // ----------------------------------------------------
    // 7. [!! 新增 !!] 將最終的 Canvas 座標轉換回 ROI 座標
    // ----------------------------------------------------
    // 為了讓輸出的 (px, py) 與輸入的 (vx, vy) 座標系一致
    const px = pcx * (width / canvasWidth);
    const py = pcy * (height / canvasHeight);

    // ----------------------------------------------------
    // 8. 應用權重 (與原始碼相同)
    // ----------------------------------------------------
    return {
        x: px * weight,
        y: py * weight,
        z: vz * weight, // 假設 z/w 座標不需要空間轉換
        w: vw * weight
    };
}
 */
    // 處理單一 bone 對 vertex 的影響
    /**
 * deformVertexByBone
 *
 * 根據單一骨骼的姿勢變換來變形頂點。
 * 此函式假設 vx, vy 是在一個與 ROI 相關的座標系統中，
 * 且骨骼的世界座標（originalHead, head）需要透過 canvasWidth/width 等比例轉換到此座標系。
 *
 * @param {number} vx - 頂點 X 座標 (ROI 空間)
 * @param {number} vy - 頂點 Y 座標 (ROI 空間)
 * @param {number} vz - 頂點 Z 座標
 * @param {number} vw - 頂點 W 座標
 * @param {object} bone - 骨骼物件
 * @param {number} weight - 骨骼權重
 * @param {number} width - ROI 寬度 (像素)
 * @param {number} height - ROI 高度 (像素)
 * @param {number} canvasWidth - Canvas 總寬度 (像素)
 * @param {number} canvasHeight - Canvas 總高度 (像素)
 * @param {number} top - ROI 頂部偏移 (未使用，但保留參數)
 * @param {number} left - ROI 左側偏移 (未使用，但保留參數)
 * @returns {{x: number, y: number, z: number, w: number}} - 變形後的頂點加權座標
 */
function deformVertexByBone(
  vx, vy, vz, vw,
  bone, weight,
  width, height,
  canvasWidth, canvasHeight,
  top, left
) {
  // 取得骨骼的當前姿勢（Pose）世界變換
  const poseTransform = bone.getGlobalPoseTransform();
  const head = poseTransform.head;           // 姿勢骨頭頭部位置 (世界/Canvas 座標)
  const originalHead = bone.getGlobalHead(); // 綁定骨頭頭部位置 (世界/Canvas 座標)

  // ----------------------------------------------------
  // 1. 計算變形所需的參數
  // ----------------------------------------------------

  // 旋轉差值 (Rotation Delta)
  const rotationDelta = poseTransform.rotation - bone.globalRotation;
  const cosR = Math.cos(rotationDelta);
  const sinR = Math.sin(rotationDelta);

  // 軸向縮放比例 (Axial Scaling Factor)
  // const scale = bone.length > 1e-6
  //   ? poseTransform.length / bone.length
  //   : 1.0;

  // 綁定姿勢下的骨骼方向
  const dirX = Math.cos(bone.globalRotation);
  const dirY = Math.sin(bone.globalRotation);

  // ----------------------------------------------------
  // 2. 轉換頂點到骨骼的綁定空間 (Localize to Bind Head)
  // ----------------------------------------------------
  const lx = (vx - (originalHead.x) * canvasWidth / width);
  const ly = (vy - (originalHead.y) * canvasHeight / height);

  // ----------------------------------------------------
  // 3. （停用縮放）直接使用原始相對座標
  // ----------------------------------------------------

  // // 原本的縮放處理：
  // const along = lx * dirX + ly * dirY;
  // const perpX = lx - along * dirX;
  // const perpY = ly - along * dirY;
  // const scaledAlongX = along * scale * dirX;
  // const scaledAlongY = along * scale * dirY;
  // const sx = scaledAlongX + perpX;
  // const sy = scaledAlongY + perpY;

  // 改為不進行軸向縮放，直接使用 lx, ly

  const sx = (lx );
  const sy =  (ly  );
  //const sx = vx;
  //const sy = vy;

  // ----------------------------------------------------
  // 4. 應用旋轉差值 (Rotation)
  // ----------------------------------------------------
  const rx = sx * cosR - sy * sinR;
  const ry = sx * sinR + sy * cosR;

  // ----------------------------------------------------
  // 5. 轉換回世界空間 (Translate to Pose Head)
  // ----------------------------------------------------
  //const px = (rx + head.x * canvasWidth / width);
  //const py = (ry + head.y * canvasHeight / height);
const px = (lx + head.x * canvasWidth / width);
  const py = (ly + head.y * canvasHeight / height);

  // ----------------------------------------------------
  // 6. 應用權重
  // ----------------------------------------------------
  return {
    x: px * weight,
    y: py * weight,
    z: vz * weight,
    w: vw * weight
  };
}

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex];
      const vertices = layer.vertices.value;
      if (!vertices || vertices.length === 0) continue;


      const vertexGroups = layer.vertexGroup.value; // [{name, vertices:[{id, weight},...]}]
      const newVertices = new Float32Array(vertices.length);

      // === 修正:先複製原始頂點數據 ===
      newVertices.set(vertices);

      // 如果沒有 vertex group 或為空,直接使用原始頂點
      if (!vertexGroups || vertexGroups.length === 0) {
        layer.poseVertices.value = newVertices;
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, newVertices, gl.STATIC_DRAW);
        continue;
      }
      const { canvasWidth, canvasHeight, width, height, top, left } = layer.transformParams;

      // 用於追蹤哪些頂點已經被處理過
      const processedVertices = new Set();

      // 每個 group (bone) 負責更新有影響的 vertex
      for (const group of vertexGroups) {
        const bone = boneMap[group.name];
        if (!bone || !group.vertices || group.vertices.length === 0) continue;

        for (const v of group.vertices) {
          const idx = v.id * 4; // 一個 vertex 佔4個slot

          // 第一次處理這個頂點時,先清零(準備累加)
          if (!processedVertices.has(v.id)) {
            newVertices[idx] = 0;
            newVertices[idx + 1] = 0;
            newVertices[idx + 2] = 0;
            newVertices[idx + 3] = 0;
            processedVertices.add(v.id);
          }

          const vx = vertices[idx];
          const vy = vertices[idx + 1];
          const vz = vertices[idx + 2];
          const vw = vertices[idx + 3];

          const d = deformVertexByBone(vx, vy, vz, vw, bone, v.weight, width, height, canvasWidth, canvasHeight, top, left);

          // 累加 (因為可能多個bone影響同一個vertex)
          newVertices[idx] += d.x;
          newVertices[idx + 1] += d.y;
          newVertices[idx + 2] += d.z;
          newVertices[idx + 3] += d.w;
        }
      }

      layer.poseVertices.value = newVertices;
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, newVertices, gl.STATIC_DRAW);
    }





  }
  recoverSelectedVertex(currentChosedLayer) {
    console.log("recover selected vertex ...");

    const layer = glsInstance.layers[currentChosedLayer.value];
    const vertices = layer.vertices.value;

    if (!layer.originalVertices) return;

    const originalVertices = layer.originalVertices;

    // 還原每個被選取的 vertex
    for (let idx of selectedVertices.value) {
      const index = idx * 4;
      vertices[index] = originalVertices[index];
      vertices[index + 1] = originalVertices[index + 1];
      vertices[index + 2] = originalVertices[index + 2];
      vertices[index + 3] = originalVertices[index + 3];
    }

    // ✅ 強制觸發 Vue reactivity
    layer.vertices.value = new Float32Array(vertices);
    forceUpdate();
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

  Bones,
  meshSkeleton,
  skeletons,
  lastSelectedBone,
  selectedVertices
};
export const bonesInstance = new Bones();