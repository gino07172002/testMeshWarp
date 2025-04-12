import {
    skeletonVertices,
    initBone
  } from './useBone.js';
  
  export default class Timeline {
    constructor(options = {}) {
      this.keyframes = [];
      this.layers = options.layers || [];
      this.timelineLength = options.timelineLength || 1000;
  
      this.keyframeCounter = 0;
      this.playheadPosition = 0;
      this.isPlaying = false;
      this.animationStartTime = null;
  
      this.status = '';
  
      // 拖曳用
      this.isDragging = false;
      this.isDraggingKeyframe = false;
      this.draggingKeyframeId = null;
    }
  
    addKeyframe() {
        console.log("timeline add class...");
      this.keyframeCounter++;
      const newPosition = 50 * this.keyframeCounter;
      this.keyframes = this.keyframes.filter(k => k.position !== newPosition);
      const skeletonPose = [...skeletonVertices.value];
      this.keyframes.push({
        id: this.keyframeCounter,
        position: newPosition,
        skeletonPose: skeletonPose,
      });
      console.log("key frame count : ",this.keyframeCounter);
      this.status = `新增關鍵幀: ${this.keyframeCounter}`;
    }
  
    selectKeyframe(id) {
      const keyframe = this.keyframes.find(k => k.id === id);
      if (keyframe && keyframe.skeletonPose) {
        skeletonVertices.value = [...keyframe.skeletonPose];
        initBone()?.prototype.updateMeshForSkeletonPose?.();
      }
      this.status = `選擇關鍵幀: ${id}`;
    }
  
    playAnimation() {
      if (this.keyframes.length < 2) {
        alert('請至少新增兩個關鍵幀以播放動畫');
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
      const totalDuration = this.keyframes[this.keyframes.length - 1].position / 50;
      const currentTime = elapsedTime % totalDuration;
      this.playheadPosition = currentTime * 50;
  
      let startFrame = null, endFrame = null;
      for (let i = 0; i < this.keyframes.length - 1; i++) {
        if (this.keyframes[i].position / 50 <= currentTime && this.keyframes[i + 1].position / 50 >= currentTime) {
          startFrame = this.keyframes[i];
          endFrame = this.keyframes[i + 1];
          break;
        }
      }
  
      if (startFrame && endFrame) {
        const t = (currentTime - startFrame.position / 50) / (endFrame.position / 50 - startFrame.position / 50);
        this.interpolateSkeletonPose(startFrame.skeletonPose, endFrame.skeletonPose, t);
      }
  
      requestAnimationFrame(() => this.animate());
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
      const target = e.target;
      const containerLeft = container.getBoundingClientRect().left;
      const scrollLeft = container.scrollLeft;
  
      if (target.classList.contains('keyframe')) {
        this.isDraggingKeyframe = true;
        this.draggingKeyframeId = parseInt(target.getAttribute('data-id'));
        this.startMouseX = e.pageX - containerLeft + scrollLeft;
        this.startKeyframePosition = this.keyframes.find(k => k.id === this.draggingKeyframeId).position;
      } else {
        this.isDragging = true;
        this.startX = e.pageX - containerLeft;
        this.scrollLeft = scrollLeft;
      }
    }
  
    onDrag(e, container) {
      const containerLeft = container.getBoundingClientRect().left;
      const scrollLeft = container.scrollLeft;
  
      if (this.isDraggingKeyframe) {
        const currentMouseX = e.pageX - containerLeft + scrollLeft;
        const deltaX = currentMouseX - this.startMouseX;
        const newPosition = this.startKeyframePosition + (deltaX - deltaX % 50);
        const keyframe = this.keyframes.find(k => k.id === this.draggingKeyframeId);
        keyframe.position = newPosition;
      } else if (this.isDragging) {
        e.preventDefault();
        const x = e.pageX - containerLeft;
        const walk = (x - this.startX);
        container.scrollLeft = this.scrollLeft - walk;
      }
    }
  
    stopDrag() {
      if (this.isDraggingKeyframe) {
        const draggedKeyframe = this.keyframes.find(k => k.id === this.draggingKeyframeId);
        const finalPosition = draggedKeyframe.position;
        this.keyframes = this.keyframes.filter(k => k.id === this.draggingKeyframeId || k.position !== finalPosition);
      }
      this.isDragging = false;
      this.isDraggingKeyframe = false;
      this.draggingKeyframeId = null;
    }
  }
  