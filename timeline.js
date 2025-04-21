import {
  skeletonVertices,
  initBone,
  selectedBoneForEditing
} from './useBone.js';

import { selectedBone } from './app.js'; // 直接導入 selectedBone

export default class Timeline {
  constructor(options = {}) {
    this.keyframes = {}; // 改為對象，按骨骼ID存儲關鍵幀
    this.layers = options.layers || [];
    this.timelineLength = options.timelineLength || 1000;

    this.keyframeCounter = 0;
    this.playheadPosition = 0;
    this.isPlaying = false;
    this.animationStartTime = null;
    this.timeRange = {
      start: 0,
      end: 500,
      dragging: null
    };
    this.status = '';

    // 拖曳用
    this.isDragging = false;
    this.isDraggingKeyframe = false;
    this.draggingKeyframeId = null;
    this.draggingBoneId = null; // 新增，用於追踪拖曳的骨骼ID

    console.log(" hi make timeline! ");
  }

  // 添加關鍵幀，根據當前選中的骨骼
  addKeyframe() {
    console.log("test this...");
    if (!selectedBone.value) {
      alert('請先選擇一個骨骼');
      return;
    }
  ///  console.log(" what'my select bone .",JSON.stringify(selectedBone.value));
    const boneId = selectedBone.value;
    if (!this.keyframes[boneId]) {
      this.keyframes[boneId] = [];
    }
    this.keyframeCounter++;
    const newPosition = 50 * this.keyframeCounter;
    const skeletonPose = [...skeletonVertices.value];

   
    console.log("what's my bone id ? ",boneId);
    this.keyframes[boneId].push({
      id: this.keyframeCounter,
      position: newPosition,
      skeletonPose: skeletonPose,
    });
    console.log("this frame size:",this.keyframes[boneId].length);
    //console.log("hi keyframes? ",JSON.stringify(this.keyframes[boneId]));
    //console.log("key frame count : ", this.keyframeCounter);
    this.status = `新增關鍵幀: ${this.keyframeCounter} 給骨骼: ${boneId}`;
    console.log("timeline.keyframes size: ",JSON.stringify(this.keyframes[boneId]));
  }

  // 選擇關鍵幀，根據骨骼ID和關鍵幀ID
  selectKeyframe(boneId, keyframeId) {
    console.log(" hi select key frame",boneId,keyframeId);
    const keyframe = this.keyframes[boneId]?.find(k => k.id === keyframeId);
    if (keyframe && keyframe.skeletonPose) {
      skeletonVertices.value = [...keyframe.skeletonPose];
      initBone()?.prototype.updateMeshForSkeletonPose?.();
    }
    this.status = `選擇關鍵幀: ${keyframeId} 給骨骼: ${boneId}`;
  }

  // 播放動畫（簡化版，僅示例）
  playAnimation() {
    if (Object.keys(this.keyframes).length === 0) {
      alert('請至少新增一個關鍵幀以播放動畫');
      return;
    }
    this.isPlaying = true;
    this.animationStartTime = Date.now();
    this.animate();
  }

  stopAnimation() {
    this.isPlaying = false;
    this.playheadPosition = 0;
  }

  animate() {
    if (!this.isPlaying) return;

    const elapsedTime = (Date.now() - this.animationStartTime) / 1000;
    const totalDuration = this.timelineLength / 50; // 假設總時長為 timelineLength
    const currentTime = elapsedTime % totalDuration;
    this.playheadPosition = currentTime * 50;

    // 這裡需要根據你的動畫需求調整邏輯，例如遍歷所有骨骼的關鍵幀並插值
    requestAnimationFrame(() => this.animate());
  }

  // 插值邏輯（根據需要擴展）
  interpolateSkeletonPose(startPose, endPose, t) {
    const newPose = [];
    for (let i = 0; i < startPose.length; i++) {
      newPose[i] = startPose[i] + (endPose[i] - startPose[i]) * t;
    }
    skeletonVertices.value = newPose;
    initBone()?.prototype.updateMeshForSkeletonPose?.();
  }

  // 開始拖曳
  startDrag(e, container) {
    console.log("hi start dragging...");
    const target = e.target;
    const containerLeft = container.getBoundingClientRect().left;
    const scrollLeft = container.scrollLeft;
    
    if (target.classList.contains('keyframe')) {
      const keyframeId = parseInt(target.getAttribute('data-id'));
      const boneId = target.getAttribute('data-bone-id');
      const keyframe = this.keyframes[boneId].find(k => k.id === keyframeId);
      
      this.isDraggingKeyframe = true;
      this.draggingKeyframe = keyframe; // Store direct reference to keyframe
      this.draggingBoneId = boneId;
      this.startMouseX = e.pageX - containerLeft + scrollLeft;
      this.startKeyframePosition = keyframe.position;
      
      // Select the keyframe being dragged
      this.selectKeyframe(boneId, keyframeId);
    } else {
      this.isDragging = true;
      this.startX = e.pageX - containerLeft;
      this.scrollLeft = scrollLeft;
    }
  }
  
  // 拖曳中
  onDrag(e, container) {

    //console.log("on dragging.... is drag?  ", this.isDragging);
    const containerLeft = container.getBoundingClientRect().left;
    const scrollLeft = container.scrollLeft;
    
    if (this.isDraggingKeyframe && this.draggingKeyframe) {
      const currentMouseX = e.pageX - containerLeft + scrollLeft;
      const deltaX = currentMouseX - this.startMouseX;
      const newPosition = Math.max(0, this.startKeyframePosition + (deltaX - deltaX % 50));
      
      // Directly update the keyframe position using the stored reference
      this.draggingKeyframe.position = newPosition;
    } else if (this.isDragging) {
      e.preventDefault();
      const x = e.pageX - containerLeft;
      const walk = (x - this.startX);
      container.scrollLeft = this.scrollLeft - walk;
    }
  }
  
  // 停止拖曳
  stopDrag() {
    if (this.isDraggingKeyframe && this.draggingKeyframe && this.draggingBoneId) {
      const finalPosition = this.draggingKeyframe.position;
      
      // Remove any other keyframes at the same position
      this.keyframes[this.draggingBoneId] = this.keyframes[this.draggingBoneId].filter(
        k => k === this.draggingKeyframe || k.position !== finalPosition
      );
    }
    
    this.isDragging = false;
    this.isDraggingKeyframe = false;
    this.draggingKeyframe = null;
    this.draggingBoneId = null;
  }
  
  selectKeyframe(boneId, keyframeId) {
    console.log("hi select key frame", boneId, keyframeId);
    const keyframe = this.keyframes[boneId]?.find(k => k.id === keyframeId);
    
    if (keyframe && keyframe.skeletonPose) {
      skeletonVertices.value = [...keyframe.skeletonPose];
      initBone()?.prototype.updateMeshForSkeletonPose?.();
    }
    
    this.selectedKeyframe = keyframe; // Store reference to selected keyframe
    this.status = `選擇關鍵幀: ${keyframeId} 給骨骼: ${boneId}`;
  }

  // 新增方法：展平骨骼樹並計算Y位置
  getFlattenedBones(node, depth = 0, result = []) {
    result.push({ id: node.id, trackY: depth * 20 }); // 每個軌道高度固定為20px
    node.children?.forEach(child => this.getFlattenedBones(child, depth + 1, result));
    return result;
  }
}