import {
  skeletonVertices,
  initBone,
  selectedBoneForEditing
} from './useBone.js';

import { selectedBone } from './app.js';

export default class Timeline {
  constructor(options = {}) {
    this.keyframes = {};
    this.layers = options.layers || [];
    this.timelineLength = options.timelineLength || 1000;
    this.onUpdate = options.onUpdate || function () {};
    this.vueInstance = options.vueInstance || null;
    this.keyframeCounter = 0;
    this.playheadPosition = 0;
    this.testCount = 0;
    this.dragInfo = null;
    this.isPlaying = false;
    this.animationStartTime = null;
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
    this.addKeyframe = this.addKeyframe.bind(this);
    this.playAnimation = this.playAnimation.bind(this);
    this.animate = this.animate.bind(this);
    this.stopAnimation = this.stopAnimation.bind(this);
    this.testCountFn = this.testCountFn.bind(this);
    this.startPlayheadDrag = this.startPlayheadDrag.bind(this);
    this.onPlayheadDrag = this.onPlayheadDrag.bind(this);
    this.stopPlayheadDrag = this.stopPlayheadDrag.bind(this);
    console.log(" hi make timeline! ");
  }

  testCountFn() {
    this.testCount = this.testCount + 1;
    console.log("hi test Count : ", this.testCount);
    this.onUpdate();
  }

  addKeyframe() {
    console.log("test this...");
    if (!selectedBone.value) {
      alert('請先選擇一個骨骼');
      return;
    }
    const boneId = selectedBone.value.id;
    if (!this.keyframes[boneId]) {
      this.keyframes[boneId] = [];
    }
    this.onUpdate();
    this.keyframeCounter++;
    const newPosition = this.playheadPosition;
    const skeletonPose = [...skeletonVertices.value];

    this.onUpdate();
    console.log("what's my bone id ? ", JSON.stringify(boneId));
    this.keyframes[boneId].push({
      id: this.keyframeCounter,
      position: newPosition,
      time: newPosition / 50,
      skeletonPose: skeletonPose
    });
    console.log("this frame size:", this.keyframes[boneId].length);
    this.status = `新增關鍵幀: ${this.keyframeCounter} 給骨骼: ${boneId}`;
    this.onUpdate();
  }

  startPlayheadDrag(event) {
    const tracksRect = this.vueInstance.$refs.timelineTracks.getBoundingClientRect();
    const offsetX = event.clientX - tracksRect.left;
    this.dragInfo = { dragging: true, startX: event.clientX, type: 'selection', offsetX };
    this.timeSelection = { active: true, start: offsetX, end: offsetX };
    this.playheadPosition = offsetX;
    this.onUpdate();
  }

  stopPlayheadDrag() {
    if (!this.dragInfo) return;
    this.dragInfo.dragging = false;
  }

  /*
  onPlayheadDrag(event) {
    if (!this.dragInfo) return;
    if (!this.dragInfo.dragging) return;

    const tracksRect = this.vueInstance.$refs.timelineTracks.getBoundingClientRect();
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
    this.onUpdate();
  }
  */
  onPlayheadDrag(event) {
    if (!this.dragInfo || !this.dragInfo.dragging) return;
    const tracksRect = this.vueInstance.$refs.timelineTracks.getBoundingClientRect();
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
  
    // 獲取當前時間點的關鍵幀並更新姿態
    this.getKeyframesBeforeCurrentTime();
    this.currentKeyframeInfo.forEach(info => {
      const { boneId, keyframeIndex, interpolationRatio } = info;
      const keyframes = this.keyframes[boneId];
      const currentKeyframe = keyframes[keyframeIndex];
      const prevKeyframe = keyframeIndex > 0 ? keyframes[keyframeIndex - 1] : null;
  
      if (prevKeyframe && currentKeyframe.skeletonPose && prevKeyframe.skeletonPose) {
        this.interpolateSkeletonPose(
          prevKeyframe.skeletonPose,
          currentKeyframe.skeletonPose,
          interpolationRatio
        );
      } else if (currentKeyframe.skeletonPose) {
        skeletonVertices.value = [...currentKeyframe.skeletonPose];
        initBone()?.prototype.updateMeshForSkeletonPose?.();
      }
    });
  
    this.onUpdate();
  }
  selectKeyframe(boneId, keyframeId) {
    console.log(" hi select key frame", boneId, keyframeId);
    const keyframe = this.keyframes[boneId]?.find(k => k.id === keyframeId);
    if (keyframe && keyframe.skeletonPose) {
      skeletonVertices.value = [...keyframe.skeletonPose];
      initBone()?.prototype.updateMeshForSkeletonPose?.();
    }
    this.status = `選擇關鍵幀: ${keyframeId} 給骨骼: ${boneId}`;
  }

  playAnimation() {
    console.log("play animation in timeline!  ");
    this.isPlaying = true;
    const currentTime = Date.now();
    const timePerUnit = 20;
    this.animationStartTime = currentTime - (this.playheadPosition * timePerUnit);
    this.animate();
  }

  stopAnimation() {
    this.isPlaying = false;
    this.playheadPosition = 0;
  }
/*
  animate() {
    if (!this.isPlaying) return;

    const elapsedTime = Date.now() - this.animationStartTime;
    const totalDuration = (this.timelineLength * 20);
    const loopedTime = elapsedTime % totalDuration;
    this.playheadPosition = loopedTime / 20;

   // console.log("this.playheadPosition ", this.playheadPosition);
    requestAnimationFrame(() => this.animate());
    this.onUpdate();
  }
  */
  animate() {
    if (!this.isPlaying) return;
    const elapsedTime = Date.now() - this.animationStartTime;
    const totalDuration = this.timelineLength * 20;
    const loopedTime = elapsedTime % totalDuration;
    this.playheadPosition = loopedTime / 20;
  
    // 獲取當前時間點的關鍵幀資訊
    this.getKeyframesBeforeCurrentTime();
    this.currentKeyframeInfo.forEach(info => {
      const { boneId, keyframeIndex, interpolationRatio } = info;
      const keyframes = this.keyframes[boneId];
      const currentKeyframe = keyframes[keyframeIndex];
      const prevKeyframe = keyframeIndex > 0 ? keyframes[keyframeIndex - 1] : null;
  
      if (prevKeyframe && currentKeyframe.skeletonPose && prevKeyframe.skeletonPose) {
        this.interpolateSkeletonPose(
          prevKeyframe.skeletonPose,
          currentKeyframe.skeletonPose,
          interpolationRatio
        );
      } else if (currentKeyframe.skeletonPose) {
        skeletonVertices.value = [...currentKeyframe.skeletonPose];
        initBone()?.prototype.updateMeshForSkeletonPose?.();
      }
    });
  
    requestAnimationFrame(() => this.animate());
    this.onUpdate();
  }

  interpolateSkeletonPose(startPose, endPose, t) {
    const newPose = [];
    for (let i = 0; i < startPose.length; i++) {
      newPose[i] = startPose[i] + (endPose[i] - startPose[i]) * t;
    }
    skeletonVertices.value = newPose;
    initBone()?.prototype.updateMeshForSkeletonPose?.();
  }

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
    result.push({ id: node.id, trackY: depth * 20 });
    node.children?.forEach(child => this.getFlattenedBones(child, depth + 1, result));
    return result;
  }

  // 新增方法：獲取當前時間點前的關鍵幀資訊
  getKeyframesBeforeCurrentTime() {
    console.log(" interpolation ... ");
    const currentTime = this.playheadPosition;
    const keyframeInfo = [];

    // 遍歷所有骨骼的關鍵幀
    Object.keys(this.keyframes).forEach(boneId => {
      const keyframes = this.keyframes[boneId]
        .filter(k => k.position <= currentTime)
        .sort((a, b) => a.position - b.position);

      if (keyframes.length > 0) {
        // 找到最接近當前時間點的關鍵幀
        const lastKeyframe = keyframes[keyframes.length - 1];
        const prevKeyframe = keyframes.length > 1 ? keyframes[keyframes.length - 2] : null;

        let interpolationRatio = 0;
        if (prevKeyframe && lastKeyframe.position > prevKeyframe.position) {
          interpolationRatio = (currentTime - prevKeyframe.position) / (lastKeyframe.position - prevKeyframe.position);
          interpolationRatio = Math.max(0, Math.min(1, interpolationRatio));
        } else if (lastKeyframe.position === currentTime) {
          interpolationRatio = 1;
        }

        keyframeInfo.push({
          boneId: boneId,
          keyframeIndex: this.keyframes[boneId].indexOf(lastKeyframe),
          keyframeId: lastKeyframe.id,
          position: lastKeyframe.position,
          interpolationRatio: interpolationRatio
        });
      }
    });

    this.currentKeyframeInfo = keyframeInfo; // 儲存到實例變數
    return keyframeInfo;
  }
}