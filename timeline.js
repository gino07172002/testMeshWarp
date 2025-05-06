import {
  skeletonVertices,
  skeletonVerticesLast,
  initBone,
  selectedBoneForEditing
} from './useBone.js';

import { selectedBone } from './app.js';
import { boneTree } from './app.js'
import { boneIdToIndexMap } from './app.js';


import glsInstance from './useWebGL.js';
// Assuming updateMeshForSkeletonPose is available globally or passed via init
let updateMeshForSkeletonPose;

// Bone inheritance properties structure
const boneInheritanceSettings = {};

// Initialize default inheritance settings for a bone
function initBoneInheritance(boneId) {
  if (!boneInheritanceSettings[boneId]) {
    boneInheritanceSettings[boneId] = {
      inheritPosition: true,
      inheritRotation: true,
      inheritScale: true
    };
  }
  return boneInheritanceSettings[boneId];
}

// Function to update a bone's inheritance settings
export function setBoneInheritance(boneId, settings) {
  const currentSettings = initBoneInheritance(boneId);
  boneInheritanceSettings[boneId] = {
    ...currentSettings,
    ...settings
  };
}

export default class Timeline {
  constructor(options = {}) {
    this.keyframes = {};
    this.layers = options.layers || [];
    this.timelineLength = options.timelineLength || 1000;
    this.onUpdate = options.onUpdate || function () { };
    this.vueInstance = options.vueInstance || null;
    this.keyframeCounter = 0;
    this.playheadPosition = 0;
    this.testCount = 0;
    this.dragInfo = null;
    this.isPlaying = false;
    this.animationStartTime = null;
    this.timeSelection = { active: false, start: 0, end: 0 };
    this.timeRange = {
      start: 0,
      end: 500,
      dragging: null
    };
    this.status = '';
    this.isDragging = false;
    this.isDraggingKeyframe = false;
    this.draggingKeyframeId = null;
    this.draggingBoneId = null;
    this.selectedKeyframe = null;
    this.addKeyframe = this.addKeyframe.bind(this);
    this.playAnimation = this.playAnimation.bind(this);
    this.animate = this.animate.bind(this);
    this.testCountFn = this.testCountFn.bind(this);
    this.startPlayheadDrag = this.startPlayheadDrag.bind(this);
    this.onPlayheadDrag = this.onPlayheadDrag.bind(this);
    this.stopPlayheadDrag = this.stopPlayheadDrag.bind(this);
    // Store bone parent-child relationships
    this.boneParentMap = {};
    // Initialize updateMeshForSkeletonPose if provided
    updateMeshForSkeletonPose = options.updateMeshForSkeletonPose || function () { console.log("updateMeshForSkeletonPose not provided") };
    console.log("Timeline initialized");
    // Store original bone positions for reference
    this.originalBoneTransforms = {};

    // Add a method to initialize original bone positions
    this.initOriginalBonePositions = this.initOriginalBonePositions.bind(this);
    this.getOriginalLocalBoneTransform = this.getOriginalLocalBoneTransform.bind(this);

  }

  // Method to build and update the bone parent map
  updateBoneParentMap(rootBone) {
    if (!rootBone)
      return;

    const traverseBone = (bone) => {
      bone.children.forEach(child => {
        this.boneParentMap[child.id] = bone.id;
        traverseBone(child);
      });
    };

    traverseBone(rootBone);
   
  }

  testCountFn() {
    this.testCount = this.testCount + 1;
    console.log("Test Count: ", this.testCount);
    this.onUpdate();
  }

  getKeyframe(boneId) {
    const index = boneIdToIndexMap[boneId];
   
    glsInstance.resetMeshToOriginal();
  }

  // Convert from head-tail coordinates to transform properties
  vertexToBoneTransform(headX, headY, tailX, tailY) {
    // Position is the head position
    const position = { x: headX, y: headY };

    // Calculate rotation (angle in radians)
    const deltaX = tailX - headX;
    const deltaY = tailY - headY;
    const rotation = Math.atan2(deltaY, deltaX);

    // Calculate scale (bone length)
    const scale = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    return { position, rotation, scale };
  }

  // Convert from transform properties back to head-tail coordinates
  boneTransformToVertex(transform) {
    const { position, rotation, scale } = transform;

    // Head position
    const headX = position.x;
    const headY = position.y;

    // Tail position (calculated from head, rotation and scale)
    const tailX = headX + Math.cos(rotation) * scale;
    const tailY = headY + Math.sin(rotation) * scale;

    return [headX, headY, tailX, tailY];
  }

  // Get local transform (without parent influence)
  getLocalBoneTransform(boneId, globalTransform) {
    const parentId = this.boneParentMap[boneId];
    if (!parentId) return globalTransform; // No parent, local = global

    // Get inheritance settings
    const inheritSettings = initBoneInheritance(boneId);

    // Get parent transform from current skeleton (using tail position)
    const parentIndex = boneIdToIndexMap[parentId];
    const parentHeadX = skeletonVertices.value[parentIndex * 4];
    const parentHeadY = skeletonVertices.value[parentIndex * 4 + 1];
    const parentTailX = skeletonVertices.value[parentIndex * 4 + 2];
    const parentTailY = skeletonVertices.value[parentIndex * 4 + 3];
    const parentTransform = this.vertexToBoneTransform(
      parentHeadX, parentHeadY, parentTailX, parentTailY
    );

    // Create local transform by removing parent influence
    const localTransform = {
      position: { ...globalTransform.position },
      rotation: globalTransform.rotation,
      scale: globalTransform.scale
    };

    // Adjust position to be relative to parent's tail
    if (inheritSettings.inheritPosition) {
      // Calculate parent's tail position
      const parentTailPos = {
        x: parentHeadX + Math.cos(parentTransform.rotation) * parentTransform.scale,
        y: parentHeadY + Math.sin(parentTransform.rotation) * parentTransform.scale
      };
      // Local position is child's global position relative to parent's tail
      localTransform.position.x = globalTransform.position.x - parentTailPos.x;
      localTransform.position.y = globalTransform.position.y - parentTailPos.y;
    }

    if (inheritSettings.inheritRotation) {
      localTransform.rotation -= parentTransform.rotation;
    }

    if (inheritSettings.inheritScale) {
      localTransform.scale /= parentTransform.scale;
    }

    return localTransform;
  }

  initOriginalBonePositions() {
    // Loop through all bones in the skeleton
    Object.keys(boneIdToIndexMap).forEach(boneId => {
      const index = boneIdToIndexMap[boneId];

      // Get original vertex positions
      const headX = skeletonVertices.value[index * 4];
      const headY = skeletonVertices.value[index * 4 + 1];
      const tailX = skeletonVertices.value[index * 4 + 2];
      const tailY = skeletonVertices.value[index * 4 + 3];

      // Convert to transform data
      const transform = this.vertexToBoneTransform(headX, headY, tailX, tailY);

      // Store original transform for this bone
      this.originalBoneTransforms[boneId] = transform;
    });

    console.log("Original bone positions initialized");
  }
  getOriginalLocalBoneTransform(boneId) {
    // 獲取骨骼的原始全域變換

    if (Object.keys(this.originalBoneTransforms).length == 0) {
      console.log(" no  such map, init ");
      this.initOriginalBonePositions();
    }
    const originalGlobalTransform = this.originalBoneTransforms[boneId];
    const parentId = this.boneParentMap[boneId];

    // 如果沒有父骨骼，本地變換等於全域變換
    if (!parentId) return { ...originalGlobalTransform };

    // 獲取繼承設定
    const inheritSettings = initBoneInheritance(boneId);

    // 獲取父骨骼的原始全域變換
    const parentOriginalGlobalTransform = this.originalBoneTransforms[parentId];

    // 計算父骨骼的原始尾部位置
    const parentTailPos = {
      x: parentOriginalGlobalTransform.position.x + Math.cos(parentOriginalGlobalTransform.rotation) * parentOriginalGlobalTransform.scale,
      y: parentOriginalGlobalTransform.position.y + Math.sin(parentOriginalGlobalTransform.rotation) * parentOriginalGlobalTransform.scale
    };

    // 創建本地變換，初始複製全域變換
    const localTransform = {
      position: { ...originalGlobalTransform.position },
      rotation: originalGlobalTransform.rotation,
      scale: originalGlobalTransform.scale
    };

    // 根據繼承設定調整本地變換
    if (inheritSettings.inheritPosition) {
      localTransform.position.x -= parentTailPos.x;
      localTransform.position.y -= parentTailPos.y;
    }
    // 如果不繼承位置，保留全域位置（已在複製時設定）

    if (inheritSettings.inheritRotation) {
      localTransform.rotation -= parentOriginalGlobalTransform.rotation;
    }
    // 如果不繼承旋轉，保留全域旋轉

    if (inheritSettings.inheritScale) {
      localTransform.scale /= parentOriginalGlobalTransform.scale;
    }
    // 如果不繼承縮放，保留全域縮放

    return localTransform;
  }

  addKeyframe() {
    console.log("Adding keyframe...");
    if (!selectedBone.value) {
      alert('請先選擇一個骨骼');
      return;
    }

    // FIX 1: Always get the boneId from the selectedBone
    let boneId = "";
    let index = -1;

    // First check if we have a direct ID in the selectedBone
    if (selectedBone.value.id) {
      boneId = selectedBone.value.id;
      index = boneIdToIndexMap[boneId]; // Get index from ID
    }
    // If no ID but we have an index, find the corresponding ID
    else if (selectedBone.value.index !== undefined) {
      index = selectedBone.value.index;
      // Find the ID that maps to this index
      for (const key in boneIdToIndexMap) {
        if (boneIdToIndexMap[key] === index) {
          boneId = key;
          break;
        }
      }
    }

    // Safety check - make sure we have both ID and index
    if (!boneId || index === -1) {
      console.error("Could not determine bone ID or index for selected bone", selectedBone.value);
      return;
    }

    if (!this.keyframes[boneId]) {
      this.keyframes[boneId] = [];
    }

    const newPosition = this.playheadPosition;
    console.log("Adding frame for selected bone:", JSON.stringify(selectedBone.value));

    // Get current bone vertex positions
    const headX = skeletonVertices.value[index * 4];
    const headY = skeletonVertices.value[index * 4 + 1];
    const tailX = skeletonVertices.value[index * 4 + 2];
    const tailY = skeletonVertices.value[index * 4 + 3];

    // Convert to global transform data (position, rotation, scale)
    const globalTransform = this.vertexToBoneTransform(headX, headY, tailX, tailY);

    // Convert to local transform if bone has a parent
    const localTransform = this.getLocalBoneTransform(boneId, globalTransform);

    // Calculate transformation relative to original position
    const originalTransform = this.originalBoneTransforms[boneId] || globalTransform;
    const relativeTransform = this.calculateRelativeTransform(globalTransform, originalTransform);

    console.log("Bone transform (local):", JSON.stringify(localTransform));
    console.log("Bone transform (relative to original):", JSON.stringify(relativeTransform));

    this.keyframes[boneId].push({
      id: this.keyframeCounter,
      position: newPosition,
      time: newPosition / 50,
      transform: localTransform, // Store local transform in keyframe
      relativeTransform: relativeTransform // Store relative transform in keyframe
    });

    this.keyframeCounter++;
    this.status = `新增關鍵幀: ${this.keyframeCounter} 給骨骼: ${boneId}`;
    this.onUpdate();
    console.log("Keyframes for this bone:", this.keyframes[boneId].length);
  }

  calculateRelativeTransform(currentTransform, originalTransform) {
    // Calculate position difference
    const positionDiff = {
      x: currentTransform.position.x - originalTransform.position.x,
      y: currentTransform.position.y - originalTransform.position.y
    };

    // Calculate rotation difference
    // Normalize angles to avoid issues with angle wrapping
    let currentRotation = currentTransform.rotation;
    let originalRotation = originalTransform.rotation;

    while (currentRotation > Math.PI) currentRotation -= 2 * Math.PI;
    while (currentRotation <= -Math.PI) currentRotation += 2 * Math.PI;

    while (originalRotation > Math.PI) originalRotation -= 2 * Math.PI;
    while (originalRotation <= -Math.PI) originalRotation += 2 * Math.PI;

    // Calculate shortest path for rotation difference
    let rotationDiff = currentRotation - originalRotation;
    if (rotationDiff > Math.PI) rotationDiff -= 2 * Math.PI;
    if (rotationDiff <= -Math.PI) rotationDiff += 2 * Math.PI;

    // Calculate scale ratio
    const scaleRatio = currentTransform.scale / originalTransform.scale;

    return {
      position: positionDiff,
      rotation: rotationDiff,
      scale: scaleRatio
    };
  }

  startPlayheadDrag(event) {

    
    const tracksRect = this.vueInstance.$refs.timelineTracks.getBoundingClientRect();
    const offsetX = event.clientX - tracksRect.left;
    this.dragInfo = { dragging: true, startX: event.clientX, type: 'selection', offsetX };

    console.log("on start! ");

    let newPosition = event.clientX - tracksRect.left;
    newPosition = Math.max(0, Math.min(newPosition, this.timelineLength));

    if (this.dragInfo.type === 'playhead') {
      this.playheadPosition = newPosition;
    } else if (this.dragInfo.type === 'selection') {
      if (newPosition >= this.dragInfo.offsetX) {
        this.timeSelection.start = this.dragInfo.offsetX;
        this.timeSelection.end = newPosition;
      } else {
        this.timeSelection.start = newPosition;
        this.timeSelection.end = this.dragInfo.offsetX;
      }
      this.playheadPosition = newPosition;
    }

    for(let i=0;i<5;i++)
      {
    if (Object.keys(boneTree).length != 0) {
      this.updateSkeletonWithInheritance();
    }
    // Update bone poses based on keyframes with inheritance

    this.onUpdate();
  }

    
  }

  stopPlayheadDrag() {
    if (!this.dragInfo) return;
    this.dragInfo.dragging = false;
  
  }

  onPlayheadDrag(event) {
    if (!this.dragInfo || !this.dragInfo.dragging) return;
  
    const tracksRect = this.vueInstance.$refs.timelineTracks.getBoundingClientRect();
  
    // 获取鼠标相对于时间轴轨道的像素位置
    let x = event.clientX - tracksRect.left;
    x = Math.max(0, Math.min(x, tracksRect.width)); // 限制在轨道范围内
  
    // 获取时间轴总时间（秒）
    const totalDuration = this.timelineLength;
  
    // 将像素位置转换为时间值（秒）
    const time = (x / tracksRect.width) * totalDuration;
  
    // 对齐到 0.1 秒的整数倍
    const alignedTime = Math.round(time / 10) * 10;
  
    // 将对齐后的时间值转换回像素位置
    let alignedX = (alignedTime / totalDuration) * tracksRect.width;
  
    // 再次限制在轨道范围内（防止浮点误差导致溢出）
    alignedX = Math.max(0, Math.min(alignedX, tracksRect.width));
  
    // 更新位置
    const newPosition = alignedX;
  
    // 根据拖动类型更新 playhead 或 selection
    if (this.dragInfo.type === 'playhead') {
      this.playheadPosition = newPosition;
    } else if (this.dragInfo.type === 'selection') {
      if (newPosition >= this.dragInfo.offsetX) {
        this.timeSelection.start = this.dragInfo.offsetX;
        this.timeSelection.end = newPosition;
      } else {
        this.timeSelection.start = newPosition;
        this.timeSelection.end = this.dragInfo.offsetX;
      }
      this.playheadPosition = newPosition;
    }
  
    // 更新骨骼动画（如果有）
    if (Object.keys(boneTree).length !== 0) {
      this.updateSkeletonWithInheritance();
    }
  
    // 触发更新
    this.onUpdate();
  }

  dfsTraverse(node, parent = null, localTransformMap) {
    if (!node) return;

    // 印出當前節點的 id 和它的 parent
    console.log(`id: ${node.id}, parent: ${parent ? parent.id : "null"}`, "local map : ", JSON.stringify(localTransformMap));


    // 遞歸遍歷子節點，並傳遞當前節點作為 parent
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        child.parent = node;
        this.dfsTraverse(child, node, localTransformMap); // 傳遞當前節點作為 parent
      }
    }
  }

  // New method to update the skeleton considering bone inheritance
  updateSkeletonWithInheritance() {
    // 獲取所有骨骼的 ID
    const allBoneIds = Object.keys(boneIdToIndexMap);

    // 創建本地變換映射，儲存所有骨骼的本地變換
    const localTransformMap = {};

    // 第一步：處理有關鍵影格的骨骼
    this.getKeyframesBeforeCurrentTime().forEach(info => {
      const { boneId, keyframe, nextKeyframe } = info;
      let localTransform;

      if (nextKeyframe && keyframe.position < this.playheadPosition && nextKeyframe.position > this.playheadPosition) {
        // 如果播放頭在兩個關鍵影格之間，進行插值
        localTransform = this.interpolateBoneTransform(
          keyframe.transform,
          nextKeyframe.transform,
          (this.playheadPosition - keyframe.position) / (nextKeyframe.position - keyframe.position)
        );
      } else if (keyframe) {
        // 使用最近的關鍵影格的變換
        localTransform = keyframe.transform;
      }

      if (localTransform) {
        localTransformMap[boneId] = localTransform;
      }
    });

    // 第二步：處理沒有關鍵影格的骨骼
    allBoneIds.forEach(boneId => {
      if (!localTransformMap[boneId]) {
        // 如果該骨骼沒有關鍵影格，使用其原始本地變換
        localTransformMap[boneId] = this.getOriginalLocalBoneTransform(boneId);
      }
    });

    // 第三步：按層次順序（從父到子）更新所有骨骼
    const sortedBoneIds = this.getSortedBoneIds();
    const newSkeletonVertices = [...skeletonVertices.value];

    sortedBoneIds.forEach(boneId => {
      // 獲取該骨骼的本地變換
      const localTransform = localTransformMap[boneId];

      // 計算全域變換（結合父骨骼的變換）
      const globalTransform = this.calculateGlobalTransform(boneId, localTransform);

      // 將變換轉換為頂點座標
      const vertices = this.boneTransformToVertex(globalTransform);
      const index = boneIdToIndexMap[boneId];
      newSkeletonVertices[index * 4] = vertices[0];     // headX
      newSkeletonVertices[index * 4 + 1] = vertices[1]; // headY
      newSkeletonVertices[index * 4 + 2] = vertices[2]; // tailX
      newSkeletonVertices[index * 4 + 3] = vertices[3]; // tailY
    });

    // 更新骨架頂點並刷新網格
    skeletonVertices.value = newSkeletonVertices;
    updateMeshForSkeletonPose();
  }

  // Helper to get bones sorted from parent to children
  getSortedBoneIds() {
    const boneIds = Object.keys(boneIdToIndexMap);
    const visitedMap = {};
    const sortedIds = [];

    const visit = (boneId) => {
      if (visitedMap[boneId]) return;
      visitedMap[boneId] = true;

      // Process parent first
      const parentId = this.boneParentMap[boneId];
      if (parentId && !visitedMap[parentId]) {
        visit(parentId);
      }

      sortedIds.push(boneId);
    };

    // Process all bones
    boneIds.forEach(boneId => {
      if (!visitedMap[boneId]) {
        visit(boneId);
      }
    });

    return sortedIds;
  }

  // Calculate global transform from local transform considering inheritance
  calculateGlobalTransform(boneId, localTransform) {
    const parentId = this.boneParentMap[boneId];
    if (!parentId) return localTransform; // No parent, local = global

    // Get inheritance settings
    const inheritSettings = initBoneInheritance(boneId);

    // Get parent's global transform (using current skeleton vertices)
    const parentIndex = boneIdToIndexMap[parentId];
    const parentHeadX = skeletonVertices.value[parentIndex * 4];
    const parentHeadY = skeletonVertices.value[parentIndex * 4 + 1];
    const parentTailX = skeletonVertices.value[parentIndex * 4 + 2];
    const parentTailY = skeletonVertices.value[parentIndex * 4 + 3];
    const parentGlobalTransform = this.vertexToBoneTransform(
      parentHeadX, parentHeadY, parentTailX, parentTailY
    );

    // Create global transform
    const globalTransform = {
      position: { ...localTransform.position },
      rotation: localTransform.rotation,
      scale: localTransform.scale
    };

    // Apply parent influence based on inheritance settings
    if (inheritSettings.inheritPosition) {
      // Calculate parent's tail position
      const parentTailPos = {
        x: parentHeadX + Math.cos(parentGlobalTransform.rotation) * parentGlobalTransform.scale,
        y: parentHeadY + Math.sin(parentGlobalTransform.rotation) * parentGlobalTransform.scale
      };
      // Global position is local position offset from parent's tail
      globalTransform.position.x += parentTailPos.x;
      globalTransform.position.y += parentTailPos.y;
    }

    if (inheritSettings.inheritRotation) {
      globalTransform.rotation += parentGlobalTransform.rotation;
    }

    if (inheritSettings.inheritScale) {
      globalTransform.scale *= parentGlobalTransform.scale;
    }

    return globalTransform;
  }

  selectKeyframe(boneId, keyframeId) {
    console.log("Selecting keyframe:", boneId, keyframeId);

    // Get the correct bone index from the map
    const index = boneIdToIndexMap[boneId];
    if (index === undefined) {
      console.error("Invalid bone ID:", boneId);
      return;
    }

    const keyframe = this.keyframes[boneId]?.find(k => k.id === keyframeId);

    if (keyframe && keyframe.transform) {
      this.selectedKeyframe=keyframe;
      console.log(" get select key frame : ",JSON.stringify(this.selectedKeyframe),", ",this.selectedKeyframe === keyframe);
      // For selecting a keyframe, we'll set the playhead position to the keyframe position
      // and update the skeleton to show the pose at that time


      this.playheadPosition = keyframe.position;

      // FIX 7: Update bone parent map before updating the skeleton
      for (const key in boneTree) {
        this.updateBoneParentMap(boneTree[key]);
      }
      this.updateSkeletonWithInheritance();
    }
    this.status = `選擇關鍵幀: ${keyframeId} 給骨骼: ${boneId}`;
  }

  playAnimation() {
    if (this.isPlaying) {
      this.isPlaying = false;
      return;
    }
    console.log("Playing animation...");
    this.isPlaying = true;
    const currentTime = Date.now();
    const timePerUnit = 20;
    this.animationStartTime = currentTime - (this.playheadPosition * timePerUnit);
    this.animate();
  }

  animate() {
    if (!this.isPlaying) return;
    const elapsedTime = Date.now() - this.animationStartTime;
    const totalDuration = this.timelineLength * 20;
    const loopedTime = elapsedTime % totalDuration;
    this.playheadPosition = loopedTime / 20;

    // Update bone poses with inheritance
    // FIX 8: Update bone parent map before updating the skeleton during animation
    for (const key in boneTree) {
      this.updateBoneParentMap(boneTree[key]);
    }
    this.updateSkeletonWithInheritance();

    requestAnimationFrame(() => this.animate());
    this.onUpdate();
  }

  // Method to interpolate transform properties
  interpolateBoneTransform(startTransform, endTransform, t) {
    // Ensure t is between 0 and 1
    t = Math.max(0, Math.min(1, t));

    // Interpolate position
    const position = {
      x: startTransform.position.x + (endTransform.position.x - startTransform.position.x) * t,
      y: startTransform.position.y + (endTransform.position.y - startTransform.position.y) * t
    };

    // Interpolate scale
    const scale = startTransform.scale + (endTransform.scale - startTransform.scale) * t;

    // Special handling for rotation to avoid issues with angle wrapping
    // Convert angles to ensure shortest path interpolation
    let startRotation = startTransform.rotation;
    let endRotation = endTransform.rotation;

    // Normalize angles to (-PI, PI] range
    while (startRotation > Math.PI) startRotation -= 2 * Math.PI;
    while (startRotation <= -Math.PI) startRotation += 2 * Math.PI;

    while (endRotation > Math.PI) endRotation -= 2 * Math.PI;
    while (endRotation <= -Math.PI) endRotation += 2 * Math.PI;

    // Choose the shortest path for rotation
    if (endRotation - startRotation > Math.PI) {
      endRotation -= 2 * Math.PI;
    } else if (startRotation - endRotation > Math.PI) {
      startRotation -= 2 * Math.PI;
    }

    // Interpolate rotation
    const rotation = startRotation + (endRotation - startRotation) * t;

    return { position, rotation, scale };
  }

  startDrag(e, container) {
    console.log("Starting drag operation...");
    const target = e.target;
    const containerLeft = container.getBoundingClientRect().left;
    const scrollLeft = container.scrollLeft;

    if (target.classList.contains('keyframe')) {
      const keyframeId = parseInt(target.getAttribute('data-id'));
      const boneId = target.getAttribute('data-bone-id');
      const keyframe = this.keyframes[boneId].find(k => k.id === keyframeId);

      this.isDraggingKeyframe = true;
      this.draggingKeyframe = keyframe;
      this.draggingBoneId = boneId;
      this.startMouseX = e.pageX - containerLeft + scrollLeft;
      this.startKeyframePosition = keyframe.position;
      this.selectKeyframe(boneId, keyframeId);
    } else {
      this.isDragging = true;
      this.startX = e.pageX - containerLeft;
      this.scrollLeft = scrollLeft;
    }
  }

  onDrag(e, container) {
    const containerLeft = container.getBoundingClientRect().left;
    const scrollLeft = container.scrollLeft;

    if (this.isDraggingKeyframe && this.draggingKeyframe) {
      const currentMouseX = e.pageX - containerLeft + scrollLeft;
      const deltaX = currentMouseX - this.startMouseX;
      const newPosition = Math.max(0, this.startKeyframePosition + (deltaX - deltaX % 50));
      this.draggingKeyframe.position = newPosition;
    } else if (this.isDragging) {
      e.preventDefault();
      const x = e.pageX - containerLeft;
      const walk = (x - this.startX);
      container.scrollLeft = this.scrollLeft - walk;
    }
  }

  stopDrag() {
    if (this.isDraggingKeyframe && this.draggingKeyframe && this.draggingBoneId) {
      const finalPosition = this.draggingKeyframe.position;
      this.keyframes[this.draggingBoneId] = this.keyframes[this.draggingBoneId].filter(
        k => k === this.draggingKeyframe || k.position !== finalPosition
      );
    }

    this.isDragging = false;
    this.isDraggingKeyframe = false;
    this.draggingKeyframe = null;
    this.draggingBoneId = null;
  }

  getFlattenedBones(node, depth = 0, result = []) {
    result.push({
      id: node.id,
      trackY: depth * 20,
      childIds: node.children.map(child => child.id),
      parentId: node.parentId,
      index: node.index
    });

    // Update parent-child relationship map while flattening
    node.children?.forEach(child => {
      this.boneParentMap[child.id] = node.id;
      this.getFlattenedBones(child, depth + 1, result);
    });

    return result;
  }

  getKeyframesBeforeCurrentTime() {
    const currentTime = this.playheadPosition;
    const keyframeInfo = [];

    Object.keys(this.keyframes).forEach(boneId => {
      const keyframes = this.keyframes[boneId];
      if (!keyframes || keyframes.length === 0) {

        keyframeInfo.push({
          boneId: boneId,
          keyframe: null,
          nextKeyframe: null
        });
        return;

      }



      // Sort keyframes by position to ensure proper interpolation
      const sortedKeyframes = [...keyframes].sort((a, b) => a.position - b.position);

      // Find the last keyframe before or at current time and the first keyframe after current time
      let prevKeyframe = null;
      let nextKeyframe = null;

      // Binary search to find the right position in sorted keyframes
      let low = 0;
      let high = sortedKeyframes.length - 1;

      // First find the last keyframe before or at current time
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (sortedKeyframes[mid].position <= currentTime) {
          prevKeyframe = sortedKeyframes[mid];
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      // Then find the first keyframe after current time
      for (let i = 0; i < sortedKeyframes.length; i++) {
        if (sortedKeyframes[i].position > currentTime) {
          nextKeyframe = sortedKeyframes[i];
          break;
        }
      }

      // Handle cases where we're before the first keyframe or after the last keyframe
      if (!prevKeyframe && nextKeyframe) {
        // Before first keyframe - use the first keyframe
        keyframeInfo.push({
          boneId: boneId,
          keyframe: nextKeyframe,
          nextKeyframe: null
        });
      } else if (prevKeyframe && !nextKeyframe) {
        // After last keyframe - use the last keyframe
        keyframeInfo.push({
          boneId: boneId,
          keyframe: prevKeyframe,
          nextKeyframe: null
        });
      } else if (prevKeyframe && nextKeyframe) {
        // Between two keyframes - include both for interpolation
        keyframeInfo.push({
          boneId: boneId,
          keyframe: prevKeyframe,
          nextKeyframe: nextKeyframe
        });
      } else //no any keyframe
      {
        keyframeInfo.push({
          boneId: boneId,
          keyframe: null,
          nextKeyframe: null
        });
      }
    });

    this.currentKeyframeInfo = keyframeInfo;
    return keyframeInfo;
  }

  // Method to set bone inheritance properties
  setBoneInheritance(boneId, inheritProps) {
    const settings = initBoneInheritance(boneId);

    if (inheritProps.hasOwnProperty('position')) {
      settings.inheritPosition = !!inheritProps.position;
    }

    if (inheritProps.hasOwnProperty('rotation')) {
      settings.inheritRotation = !!inheritProps.rotation;
    }

    if (inheritProps.hasOwnProperty('scale')) {
      settings.inheritScale = !!inheritProps.scale;
    }

    console.log(`Updated inheritance for bone ${boneId}:`, settings);
    return settings;
  }

  // Get bone inheritance settings
  getBoneInheritance(boneId) {
    return initBoneInheritance(boneId);
  }
}

// Export the bone inheritance settings functions for use in UI components
export { initBoneInheritance, boneInheritanceSettings };