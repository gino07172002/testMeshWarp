

// timeline.js
export class Timeline2 {
  constructor(name = "UntitledAnimation", duration = 2.0, frameRate = 30) {
    this.name = name;
    this.duration = duration; // 秒
    this.frameRate = frameRate;
    this.keyframes = new Map(); // { bone.id: [ { time, rotation, x, y, length } ] }
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
    if (!this.keyframes.has(bone.id)) this.keyframes.set(bone.id, []);
    const frames = this.keyframes.get(bone.id);

    const frame = { time, rotation, x, y, length };
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
  update(deltaTime, bones) {
    if (!this.isPlaying) return;

    this.currentTime += deltaTime;
    if (this.currentTime > this.duration) {
      if (this.loop) {
        this.currentTime %= this.duration;
      } else {
        this.currentTime = this.duration;
        this.isPlaying = false;
      }
    }

    // 套用插值後結果到骨骼
    for (const [boneId, frames] of this.keyframes.entries()) {
      const bone = bones.find(b => b.id === boneId);
      if (!bone) continue;

      const interpolated = this._interpolate(frames, this.currentTime);
      if (!interpolated) continue;

      // 套用 pose 值
      if (interpolated.x !== null) bone.poseHead.x = interpolated.x;
      if (interpolated.y !== null) bone.poseHead.y = interpolated.y;
      if (interpolated.rotation !== null) bone.poseRotation = interpolated.rotation;
      if (interpolated.length !== null) bone.poseLength = interpolated.length;

      // 更新全域姿勢
      bone._markDirty?.();
      if (bone.updateFromParent) bone.updateFromParent(); // 若你的骨架系統有此方法
    }

    // 最後更新所有骨骼的 global transform
    bones.forEach(b => {
      if (!b.parent) {
        b.updateWorldTransform?.(); // 根骨更新整棵骨架
      }
    });
  }

  /** 取得目前時間對應的插值結果 */
  _interpolate(frames, time) {
    if (frames.length === 0) return null;
    if (time <= frames[0].time) return frames[0];
    if (time >= frames[frames.length - 1].time) return frames[frames.length - 1];

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