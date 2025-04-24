import {
  skeletonVertices,
  initBone,
  selectedBoneForEditing
} from './useBone.js';

import { selectedBone } from './app.js';
import glsInstance from './useWebGL.js';
// Assuming updateMeshForSkeletonPose is available globally or passed via init
let updateMeshForSkeletonPose;

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
    this.addKeyframe = this.addKeyframe.bind(this);
    this.playAnimation = this.playAnimation.bind(this);
    this.animate = this.animate.bind(this);
    this.testCountFn = this.testCountFn.bind(this);
    this.startPlayheadDrag = this.startPlayheadDrag.bind(this);
    this.onPlayheadDrag = this.onPlayheadDrag.bind(this);
    this.stopPlayheadDrag = this.stopPlayheadDrag.bind(this);
    // Initialize updateMeshForSkeletonPose if provided
    updateMeshForSkeletonPose = options.updateMeshForSkeletonPose || function () { };
    console.log(" hi make timeline! ");
  }

  testCountFn() {
    this.testCount = this.testCount + 1;
    console.log("hi test Count : ", this.testCount);
    this.onUpdate();
  }

  getKeyframe(boneId) {
    console.log(" hi get keyframe",boneId);
    glsInstance.resetMeshToOriginal();

  }

  addKeyframe() {
    console.log("test add keyframe ..");
    if (!selectedBone.value) {
      alert('請先選擇一個骨骼');
      return;
    }
    const boneId = selectedBone.value.id;
    if (!this.keyframes[boneId]) {
      this.keyframes[boneId] = [];
    }
    const newPosition = this.playheadPosition;
    console.log(" add frame : what : " ,JSON.stringify(skeletonVertices.value));
    console.log("let's look select bone : ",JSON.stringify(selectedBone.value));
    // Store only the current bone's pose (headX, headY, tailX, tailY)
    const bonePose = [
      skeletonVertices.value[boneId * 4],
      skeletonVertices.value[boneId * 4 + 1],
      skeletonVertices.value[boneId * 4 + 2],
      skeletonVertices.value[boneId * 4 + 3]
    ];
    console.log(" bone pose : ",JSON.stringify(bonePose));
    this.keyframes[boneId].push({
      id: this.keyframeCounter,
      position: newPosition,
      time: newPosition / 50,
      bonePose: bonePose
    });
    this.keyframeCounter++;
    this.status = `新增關鍵幀: ${this.keyframeCounter} 給骨骼: ${boneId}`;
    this.onUpdate();
    console.log("this frame size:", this.keyframes[boneId].length);
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

    // Update bone poses based on keyframes
    this.getKeyframesBeforeCurrentTime();
    const newSkeletonVertices = [...skeletonVertices.value];
    this.currentKeyframeInfo.forEach(info => {
      const { boneId, keyframeIndex, interpolationRatio } = info;
      const keyframes = this.keyframes[boneId];
      const currentKeyframe = keyframes[keyframeIndex];
      const prevKeyframe = keyframeIndex > 0 ? keyframes[keyframeIndex - 1] : null;

      let bonePose;
      if (prevKeyframe && currentKeyframe.bonePose && prevKeyframe.bonePose) {
        bonePose = this.interpolateBonePose(prevKeyframe.bonePose, currentKeyframe.bonePose, interpolationRatio);
      } else if (currentKeyframe.bonePose) {
        bonePose = currentKeyframe.bonePose;
      }
      if (bonePose) {
        newSkeletonVertices[boneId * 4] = bonePose[0];
        newSkeletonVertices[boneId * 4 + 1] = bonePose[1];
        newSkeletonVertices[boneId * 4 + 2] = bonePose[2];
        newSkeletonVertices[boneId * 4 + 3] = bonePose[3];
        console.log("bone pose: ",boneId," . . ",JSON.stringify(bonePose), " current key : ",JSON.stringify(currentKeyframe));
      }
      if(boneId)
      this.getKeyframe(boneId);
    });
    skeletonVertices.value = newSkeletonVertices;
    updateMeshForSkeletonPose();
    this.onUpdate();
  }

  selectKeyframe(boneId, keyframeId) {
    console.log(" hi select key frame", boneId, keyframeId);
    const keyframe = this.keyframes[boneId]?.find(k => k.id === keyframeId);
    if (keyframe && keyframe.bonePose) {
      skeletonVertices.value[boneId * 4] = keyframe.bonePose[0];
      skeletonVertices.value[boneId * 4 + 1] = keyframe.bonePose[1];
      skeletonVertices.value[boneId * 4 + 2] = keyframe.bonePose[2];
      skeletonVertices.value[boneId * 4 + 3] = keyframe.bonePose[3];
      updateMeshForSkeletonPose();
    }
    this.status = `選擇關鍵幀: ${keyframeId} 給骨骼: ${boneId}`;
  }

  playAnimation() {
    if (this.isPlaying) {
      this.isPlaying = false;
      return;
    }
    console.log("play animation in timeline!  ");
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

    // Update bone poses based on keyframes
    this.getKeyframesBeforeCurrentTime();
    const newSkeletonVertices = [...skeletonVertices.value];
    this.currentKeyframeInfo.forEach(info => {
      const { boneId, keyframeIndex, interpolationRatio } = info;
      const keyframes = this.keyframes[boneId];
      const currentKeyframe = keyframes[keyframeIndex];
      const prevKeyframe = keyframeIndex > 0 ? keyframes[keyframeIndex - 1] : null;

      let bonePose;
      if (prevKeyframe && currentKeyframe.bonePose && prevKeyframe.bonePose) {
        bonePose = this.interpolateBonePose(prevKeyframe.bonePose, currentKeyframe.bonePose, interpolationRatio);
      } else if (currentKeyframe.bonePose) {
        bonePose = currentKeyframe.bonePose;
      }
      if (bonePose) {
        newSkeletonVertices[boneId * 4] = bonePose[0];
        newSkeletonVertices[boneId * 4 + 1] = bonePose[1];
        newSkeletonVertices[boneId * 4 + 2] = bonePose[2];
        newSkeletonVertices[boneId * 4 + 3] = bonePose[3];
      }
    });
    skeletonVertices.value = newSkeletonVertices;
    updateMeshForSkeletonPose();
    requestAnimationFrame(() => this.animate());
    this.onUpdate();
  }

  interpolateBonePose(startPose, endPose, t) {
    return [
      startPose[0] + (endPose[0] - startPose[0]) * t,
      startPose[1] + (endPose[1] - startPose[1]) * t,
      startPose[2] + (endPose[2] - startPose[2]) * t,
      startPose[3] + (endPose[3] - startPose[3]) * t
    ];
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
    result.push({
      id: node.id, trackY: depth * 20, childIds: node.children.map(child => child.id),
      parentId: node.parentId,index:node.index
    });
    node.children?.forEach(child => this.getFlattenedBones(child, depth + 1, result));
    return result;
  }

  getKeyframesBeforeCurrentTime() {
    const currentTime = this.playheadPosition;
    const keyframeInfo = [];

    Object.keys(this.keyframes).forEach(boneId => {
      const originalKeyframes = this.keyframes[boneId];
      if (!originalKeyframes || originalKeyframes.length === 0) return;

      const sortedKeyframes = [...originalKeyframes].sort((a, b) => a.position - b.position);

      let low = 0;
      let high = sortedKeyframes.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (sortedKeyframes[mid].position > currentTime) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }
      const firstGreaterIndex = low;

      let prevKeyframe = null;
      let nextKeyframe = null;
      let interpolationRatio = 0;

      if (firstGreaterIndex === 0) {
        nextKeyframe = sortedKeyframes[0];
        interpolationRatio = 1;
      } else if (firstGreaterIndex === sortedKeyframes.length) {
        prevKeyframe = sortedKeyframes[sortedKeyframes.length - 1];
        interpolationRatio = 1;
      } else {
        prevKeyframe = sortedKeyframes[firstGreaterIndex - 1];
        nextKeyframe = sortedKeyframes[firstGreaterIndex];
        interpolationRatio = (currentTime - prevKeyframe.position) /
          (nextKeyframe.position - prevKeyframe.position);
      }

      interpolationRatio = Math.max(0, Math.min(1, interpolationRatio));

      const currentKeyframe = prevKeyframe || nextKeyframe;
      if (currentKeyframe) {
        keyframeInfo.push({
          boneId: boneId,
          keyframeIndex: originalKeyframes.indexOf(currentKeyframe),
          keyframeId: currentKeyframe.id,
          position: currentKeyframe.position,
          interpolationRatio: interpolationRatio
        });
      }
    });

    this.currentKeyframeInfo = keyframeInfo;
    //console.log("key frame info :", JSON.stringify(keyframeInfo));
    return keyframeInfo;
  }
}