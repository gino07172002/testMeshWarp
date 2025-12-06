const { ref, reactive, toRaw } = Vue;
import glsInstance from './useWebGL.js';
import {getMouseLocalPos} from './useWebGL.js';
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

var mousedown_NDC = null
var mousemove_NDC = null;

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
  /*
    GetCloestBoneAsSelectBone(xNDC, yNDC, isCreatMode = true) {
      const getBone = getClosestBoneAtClick(meshSkeleton, xNDC, yNDC, isCreatMode);
  
      lastSelectedBone.value = getBone ? getBone.bone : null;
      lastSelectedBonePart.value = getBone ? getBone.type : null; // 'head', 'tail', or 'middle'
      mousedown_x = xNDC;
      mousedown_y = yNDC;
  
      return getBone;
    }
      */

  GetCloestBoneAsSelectBone(x, y, isCreatMode = true) {
    const getBone = getClosestBoneAtClick(meshSkeleton, x, y, isCreatMode);

    lastSelectedBone.value = getBone ? getBone.bone : null;
    lastSelectedBonePart.value = getBone ? getBone.type : null; // 'head', 'tail', or 'middle'
    mousedown_x = x;
    mousedown_y = y;

    return getBone;
  }
  // 修改後的 handleBoneAnimateMouseDown
  handleMeshBoneAnimateMouseDown(x, y) {
    // console.log(" handleMeshBoneAnimateMouseDown at : ", xNDC, ' , ', yNDC);
    if (lastSelectedBone.value && lastSelectedBonePart.value) {
      const bone = lastSelectedBone.value;

      if (lastSelectedBonePart.value === 'head') {
        {
          // When connected, moving head also moves parent's tail
          bone.setPoseGlobalHead(x, y);
          //bone.parent.setGlobalTail(xNDC, yNDC);


        }
      } else if (lastSelectedBonePart.value === 'tail') {

        bone.setPoseGlobalTail(x, y);

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
  handleSelectPointsMouseDown(xNDC, yNDC, x, y) {
    mousedown_x = x;
    mousedown_y = y;
    mousemove_x = x;
    mousemove_y = y;
    mousedown_NDC = { x: xNDC, y: yNDC };
    mousemove_NDC = { x: xNDC, y: yNDC };

    console.log(" select points mouse down at : ", xNDC, ' , ', yNDC);
  }
  handleSelectPointsMouseMove(xNDC, yNDC, x, y) {
    mousemove_NDC = { x: xNDC, y: yNDC };
    mousemove_x = x;
    mousemove_y = y;
  }
  handleSelectPointsMouseUp(xNDC, yNDC, layerIndex, isShiftPressed = false, isCtrlPressed = false) {
    console.log(" handleSelectPointsMouseUp at : ", xNDC, ' , ', yNDC);
    
    // 框選範圍 (世界 NDC 空間)
    const minX = Math.min(mousedown_NDC.x, xNDC);
    const maxX = Math.max(mousedown_NDC.x, xNDC);
    const minY = Math.min(mousedown_NDC.y, yNDC);
    const maxY = Math.max(mousedown_NDC.y, yNDC);
    
    const layer = glsInstance.layers[layerIndex];
    // 使用 poseVertices (如果有的話) 或 vertices
    // 注意：通常選取是基於原始位置(vertices)透過矩陣變換，或者直接選取變形後的位置
    // 這裡維持你原本的邏輯：讀取原始 vertices，然後用矩陣算出現場位置
    const vertices = layer.vertices.value; 
    
    console.log(" vertices length: ", vertices.length);

    // === ✨ [修正 1] 優先使用 poseTransformParams (與 Render 邏輯同步) ===
    const params = layer.poseTransformParams || layer.transformParams;
    
    {
      const { canvasWidth, canvasHeight, left, top, width, height } = params;
      const rotation = params.rotation || 0;

      // 計算邊界
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

      // === ✨ [修正 2] 加入長寬比 (Aspect Ratio) 計算 ===
      const aspect = canvasWidth / canvasHeight;

      // === ✨ [修正 3] 矩陣應用 Aspect 修正 (與 Render 邏輯同步) ===
      const transformMatrix = new Float32Array([
        sx * cosR,              sx * sinR * aspect,       0, 0,
        -sy * sinR / aspect,    sy * cosR,                0, 0,
        0,                      0,                        1, 0,
        centerX_NDC,            centerY_NDC,              0, 1
      ]);

      // 變換函數
      const m = transformMatrix;
      const transformPoint = (v) => {
        const x = v[0], y = v[1], z = v[2], w = v[3];
        return [
          m[0] * x + m[4] * y + m[8] * z + m[12] * w,
          m[1] * x + m[5] * y + m[9] * z + m[13] * w,
          m[2] * x + m[6] * y + m[10] * z + m[14] * w
        ];
      };

      // 找出框到的點 (計算每個頂點的世界 NDC 位置)
      const newlySelected = [];
      for (let i = 0; i < vertices.length; i += 4) {
        const localVert = [
          vertices[i],     // x_local
          vertices[i + 1], // y_local
          vertices[i + 2] || 0, // z (預設 0)
          vertices[i + 3] || 1  // w (預設 1)
        ];
        
        const ndc = transformPoint(localVert);
        const ndcX = ndc[0];
        const ndcY = ndc[1];

        if (ndcX >= minX && ndcX <= maxX && ndcY >= minY && ndcY <= maxY) {
          newlySelected.push(i / 4); // push vertex index
        }
      }

      // 處理選取邏輯
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
    }

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
    const layer = glsInstance.layers[currentChosedLayer.value];
    const vertices = layer.vertices.value;

    // backup original vertices
    if (!layer.originalVertices) {
      layer.originalVertices = [...vertices];
    }

    // ✨ 1. 計算 當前滑鼠 的 Local 座標
    const currLocal = getMouseLocalPos(xNDC, yNDC, layer);

    if (!useMultiSelect && localSelectedVertex !== -1) {
      // ===== 單點移動 =====
      // 直接將頂點設定為滑鼠的 Local 位置 (吸附效果)
      const index = localSelectedVertex * 4;
      
      vertices[index] = currLocal.x;
      vertices[index + 1] = currLocal.y;

    } else if (useMultiSelect && selectedVertices.value.length > 0) {
      // ===== 群組移動 =====
      
      // ✨ 2. 計算 起始滑鼠 (dragStart) 的 Local 座標
      // 必須把 dragStart (NDC) 也轉成 Local，這樣算出來的 delta 才是正確的旋轉後方向
      const startLocal = getMouseLocalPos(dragStartX, dragStartY, layer);

      // ✨ 3. 計算 Local 空間的差值 (Delta)
      const dxLocal = currLocal.x - startLocal.x;
      const dyLocal = currLocal.y - startLocal.y;

      for (let idx of selectedVertices.value) {
        const index = idx * 4;
        vertices[index] += dxLocal;
        vertices[index + 1] += dyLocal;
      }
    }

    // 更新 VBO
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
}
  updatePoseMesh(gl) {
    console.log(" update pose mesh ... ");

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

    function deformVertexByBone(vx, vy, vz, vw, bone, weight, width, height, canvasWidth, canvasHeight, top, left) {
      const poseTransform = bone.getGlobalPoseTransform();
      const head = poseTransform.head;
      const originalHead = bone.getGlobalHead();
      const rotationDelta = poseTransform.rotation - bone.globalRotation;

      const cosR = Math.cos(rotationDelta);
      const sinR = Math.sin(rotationDelta);

      // 1. 將頂點從 NDC 轉換為圖層像素座標
      const vxLayerPixel = (vx + 1.0) * 0.5 * width;
      const vyLayerPixel = (1.0 - vy) * 0.5 * height;

      // 2. 將圖層像素座標轉換為 Canvas 像素座標
      const vxCanvasPixel = vxLayerPixel + left;
      const vyCanvasPixel = vyLayerPixel + top;

      // 3. 計算相對於原始骨頭位置的局部座標 (Canvas 空間)
      const lx = vxCanvasPixel - originalHead.x;
      const ly = vyCanvasPixel - originalHead.y;

      // 4. 應用旋轉
      const rx = lx * cosR - ly * sinR;
      const ry = lx * sinR + ly * cosR;

      // 5. 加上新的骨頭位置 (Canvas 空間)
      const pxCanvas = rx + head.x;
      const pyCanvas = ry + head.y;

      // 6. 將結果從 Canvas 像素座標轉回圖層像素座標
      const pxLayerPixel = pxCanvas - left;
      const pyLayerPixel = pyCanvas - top;

      // 7. 將圖層像素座標轉回 NDC
      const pxNDC = (pxLayerPixel / width) * 2.0 - 1.0;
      const pyNDC = 1.0 - (pyLayerPixel / height) * 2.0;

      return {
        x: pxNDC * weight,
        y: pyNDC * weight,
        z: vz * weight,
        w: vw * weight
      };
    }

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex];
      const vertices = layer.vertices.value;
      if (!vertices || vertices.length === 0) continue;

      const vertexGroups = layer.vertexGroup.value;
      const newVertices = new Float32Array(vertices.length);

      // 如果沒有 vertex group 或為空,直接使用原始頂點
      if (!vertexGroups || vertexGroups.length === 0) {
        // **修正1: 沒有骨骼影響時,應該複製原始頂點**
        newVertices.set(vertices);
        layer.poseVertices.value = newVertices;
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, newVertices, gl.STATIC_DRAW);
        continue;
      }

      const { canvasWidth, canvasHeight, width, height, top, left, rotation } = layer.transformParams;

      // **修正2: 先將所有頂點複製為原始值(作為未受影響頂點的預設值)**
      newVertices.set(vertices);

      const processedVertices = new Set();

      for (const group of vertexGroups) {
        const bone = boneMap[group.name];
        if (!bone || !group.vertices || group.vertices.length === 0) continue;

        for (const v of group.vertices) {
          const idx = v.id * 4;

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

          newVertices[idx] += d.x;
          newVertices[idx + 1] += d.y;
          newVertices[idx + 2] += d.z;
          newVertices[idx + 3] += d.w;
        }
      }

      // **修正3: 檢查權重總和,如果不足1.0,補足原始頂點的影響**
      for (const vertexId of processedVertices) {
        const idx = vertexId * 4;

        // 計算該頂點的總權重
        let totalWeight = 0;
        for (const group of vertexGroups) {
          const vertexInGroup = group.vertices.find(v => v.id === vertexId);
          if (vertexInGroup) {
            totalWeight += vertexInGroup.weight;
          }
        }

        // 如果權重總和小於1,用原始頂點補足
        if (totalWeight < 1.0) {
          const remainingWeight = 1.0 - totalWeight;
          newVertices[idx] += vertices[idx] * remainingWeight;
          newVertices[idx + 1] += vertices[idx + 1] * remainingWeight;
          newVertices[idx + 2] += vertices[idx + 2] * remainingWeight;
          newVertices[idx + 3] += vertices[idx + 3] * remainingWeight;
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

          if (layer && layer.transformParams) {
            const { left, top, width, height, canvasWidth, canvasHeight } = layer.transformParams;
            const originalRotation = layer.transformParams.rotation || 0;

            const originalCenterX = left + width / 2;
            const originalCenterY = top + height / 2;

            // 1. 計算相對於 Bone Rest Head 的原始向量
            const vecX = originalCenterX - boneRest.head.x;
            const vecY = originalCenterY - boneRest.head.y;

            // 2. 計算旋轉差值 (跟 updatePoseMesh 一模一樣: Pose - Rest)
            const rotationDelta = bonePose.rotation - boneRest.rotation;

            // 3. 使用跟 updatePoseMesh 一模一樣的旋轉公式
            // 在 Y-Down 座標系中，這會產生正確的 "順時針" 公轉
            const cos = Math.cos(rotationDelta);
            const sin = Math.sin(rotationDelta);

            const rotatedVecX = vecX * cos - vecY * sin;
            const rotatedVecY = vecX * sin + vecY * cos;

            // 4. 計算新的中心點
            const newCenterX = bonePose.head.x + rotatedVecX;
            const newCenterY = bonePose.head.y + rotatedVecY;

            // 5. 【關鍵修正】計算新的旋轉角度
            // 因為 Shader 的旋轉方向 (NDC Y-Up) 跟骨骼 (Pixel Y-Down) 是相反的
            // 骨骼順時針轉 (Delta > 0) 時，Shader 若收到正值會逆時針轉
            // 所以這裡要用 "減法" 來讓 Shader 也產生順時針效果
            const newRotation = originalRotation - rotationDelta;

            layer.poseTransformParams = {
              left: newCenterX - width / 2,
              top: newCenterY - height / 2,
              right: (newCenterX - width / 2) + width,
              bottom: (newCenterY - height / 2) + height,
              width: width,
              height: height,
              rotation: newRotation, 
              canvasWidth: canvasWidth,
              canvasHeight: canvasHeight,
              // ✨ [Added] Debug Point: The center of rotation (Pivot)
              debugPivot: { x: bonePose.head.x, y: bonePose.head.y } 
            };

            layer.visible = slot.visible;
            if (slot.color) {
              layer.opacity = { value: slot.color.a };
            }
          }
        });
      });
    });
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