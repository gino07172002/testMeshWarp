

// timeline.js
export class Timeline2 {
  constructor(name = "UntitledAnimation", duration = 2.0, frameRate = 30) {
    this.name = name;
    this.duration = duration; // 秒
    this.frameRate = frameRate;
    this.keyframes = {}; // { bone.id: [ { time, rotation, x, y, length } ] }
    this.currentTime = 0;
    this.isPlaying = false;
    this.loop = true;
  }

  /**
   * 新增一個骨骼的關鍵影格
   * 例如: addKeyframe(bone, 0.5, { rotation: 45, x: 100, y: 50 })
   */
  addKeyframe(bone, time, { rotation = null, x = null, y = null, length = null } = {}) {
    if (!bone || !bone.id) throw new Error("Invalid bone");

    console.log(" test 1");
    if (!this.keyframes[bone.id]) {
      this.keyframes[bone.id] = [];
    }

    console.log(" test 1");
    const frames = this.keyframes[bone.id];
    const frame = { time, rotation: bone.poseRotation, x: bone.poseHead.x, y: bone.poseHead.y, length: bone.poseLength };
    frames.push(frame);
    frames.sort((a, b) => a.time - b.time);
  }

  /** 控制播放 */
  play(loop = true) {
    this.isPlaying = true;
    this.loop = loop;
  }

  pause() {
    this.isPlaying = false;
  }

  stop() {
    this.isPlaying = false;
    this.currentTime = 0;
  }

  /** 更新動畫進度 */
  update(currentTime, skeletons) {
    // 防呆：skeletons 應該是陣列
    if (!Array.isArray(skeletons) || skeletons.length === 0) {
      console.warn("⚠️ No skeletons to update.");
      return;
    }

    // 收集所有 bones
    const bones = skeletons.flatMap(s => s.bones || []);
    if (bones.length === 0) {
      console.warn("⚠️ No bones found in skeletons.");
      return;
    }
    console.log("why current Time zero ? ", currentTime);

    // 更新當前時間
    /*8
    this.currentTime += deltaTime;
    if (this.currentTime > this.duration) {
      if (this.loop) {
        this.currentTime %= this.duration;
      } else {
        this.currentTime = this.duration;
        this.isPlaying = false;
      }
    }
      */

    //let time = currentTime;

    // 套用插值結果到骨骼
    if (this.keyframes) {
      for (const boneId in this.keyframes) {
        const frames = this.keyframes[boneId];
        const bone = bones.find(b => b.id === boneId);

        console.log("find bone?", bone, "boneId?", boneId);
        if (!bone) continue;

        const interpolated = this._interpolate(frames, currentTime);

        console.log("interpolated?", interpolated.x, " , ", interpolated.y, " , ", interpolated.rotation, " , ", interpolated.length);

        if (!interpolated) continue;


        if (interpolated.x != null) bone.poseHead.x = interpolated.x;
        if (interpolated.y != null) bone.poseHead.y = interpolated.y;
        if (interpolated.rotation != null) bone.poseRotation = interpolated.rotation;
        if (interpolated.length != null) bone.poseLength = interpolated.length;

        bone._markDirty?.();
        // bone.updateFromParent?.();
      }
    }



    // 更新根骨骼的 global transform
    bones.forEach(b => {
      if (!b.parent) b.updateWorldTransform?.();
    });
  }

  /** 插值函數不用改 */
  _interpolate(frames, time) {

    console.log(" checking time is between frames: time = ", time, "frames[0]?", frames[0].time, "frames[-1]?", frames[frames.length - 1].time);

    if (frames.length === 0) return null;
    if (time <= frames[0].time) return frames[0];
    if (time >= frames[frames.length - 1].time) return frames[frames.length - 1];

    console.log(" hello interpolate?", frames, "time?", time);
    let f1, f2;
    for (let i = 0; i < frames.length - 1; i++) {
      if (time >= frames[i].time && time <= frames[i + 1].time) {
        f1 = frames[i];
        f2 = frames[i + 1];
        break;
      }
    }

    const t = (time - f1.time) / (f2.time - f1.time);
    const lerp = (a, b) => a + (b - a) * t;

    return {
      x: f1.x !== null && f2.x !== null ? lerp(f1.x, f2.x) : null,
      y: f1.y !== null && f2.y !== null ? lerp(f1.y, f2.y) : null,
      rotation: f1.rotation !== null && f2.rotation !== null ? lerp(f1.rotation, f2.rotation) : null,
      length: f1.length !== null && f2.length !== null ? lerp(f1.length, f2.length) : null,
    };
  }
}