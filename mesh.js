// mesh.js


//temporarily put here
const { defineStore } = Pinia;
// Counter Store (保留原樣)
export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0 }),
  actions: {
    increment() { this.count++; },
  },
});

/**
 * ID 生成器，避免汙染全域變數
 */
class IdGenerator {
  static counters = { bone: 0, slot: 0, mesh: 0 };
  static next(prefix = 'obj') {
    if (!this.counters[prefix]) this.counters[prefix] = 0;
    return `${prefix}_${this.counters[prefix]++}_${Date.now().toString(36).slice(-4)}`;
  }
}

/**
 * 數學工具庫 - 統一處理向量與變換
 */
export class MathUtils {
  static degToRad(deg) { return deg * Math.PI / 180; }
  static radToDeg(rad) { return rad * 180 / Math.PI; }
  
  static distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  static distanceToLineSegment(px, py, x1, y1, x2, y2) {
    const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
    const lenSq = C * C + D * D;
    if (lenSq === 0) return Math.sqrt(A * A + B * B);
    
    let param = (A * C + B * D) / lenSq;
    param = Math.max(0, Math.min(1, param)); // Clamp 0..1

    const xx = x1 + param * C;
    const yy = y1 + param * D;
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 2D 向量旋轉 (繞原點)
   */
  static rotate(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos
    };
  }

  /**
   * 座標變換：本地 -> 全域
   */
  static localToGlobal(localX, localY, parentHead, parentRotation) {
    const rotated = this.rotate(localX, localY, parentRotation);
    return {
      x: parentHead.x + rotated.x,
      y: parentHead.y + rotated.y
    };
  }

  /**
   * 座標變換：全域 -> 本地
   */
  static globalToLocal(globalX, globalY, parentHead, parentRotation) {
    const dx = globalX - parentHead.x;
    const dy = globalY - parentHead.y;
    // 反向旋轉
    return this.rotate(dx, dy, -parentRotation);
  }
}

// 為了相容舊代碼的 export
export const Utils = MathUtils;


// ---------------------------------------------------------
// 📦 2. 核心數據結構 (Vertex, Attachment, Slot)
// ---------------------------------------------------------

export class Vertex {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.groups = {}; // { groupName: weight }
    
    // 動畫用 Pose
    this.poseX = x;
    this.poseY = y;
  }

  setWeight(groupName, weight) {
    if (weight <= 0) {
      delete this.groups[groupName];
    } else {
      this.groups[groupName] = Math.max(0, Math.min(1, weight));
    }
  }

  getWeight(groupName) { return this.groups[groupName] || 0; }
  removeWeight(groupName) { delete this.groups[groupName]; }

  resetPose() {
    this.poseX = this.x;
    this.poseY = this.y;
  }

  clone() {
    const v = new Vertex(this.x, this.y);
    v.groups = { ...this.groups };
    return v;
  }
}

/**
 * 基礎附件類別 (Spine Attachment)
 */
export class Attachment {
  constructor(data = {}) {
    this.name = data.name || 'Unnamed';
    this.type = data.type || 'region'; // region, mesh
    this.visible = data.visible ?? true;
    
    // 渲染屬性
    this.image = data.image || data.imageData || null; // 原始數據
    this.texture = data.texture || null; // WebGL Texture
    
    // 尺寸與位置 (對應圖層)
    this.width = data.width || 0;
    this.height = data.height || 0;
    this.coords = {
      top: data.top || 0,
      left: data.left || 0,
      bottom: data.bottom || 0,
      right: data.right || 0
    };

    // 網格數據 (如果是 Mesh Attachment)
    this.vertices = data.vertices || [];
    this.indices = data.indices || [];
    this.poseVertices = data.poseVertices || [];
    
    // 透明度
    this.opacity = data.opacity ?? 1.0;
    
    // 參照 ID (用於 WebGL Layer 查找)
    this.refId = data.refId ?? null;
  }
}

/**
 * 插槽類別 (Spine Slot) - 骨骼上的掛載點
 */
export class Slot {
  constructor({
    name,
    bone,
    attachments = {},
    currentAttachmentName = null,
    color = { r: 1, g: 1, b: 1, a: 1 },
    blendMode = 'normal',
    visible = true,
  }) {
    if (!name) throw new Error('Slot name required');
    if (!bone) throw new Error('Slot must attach to a Bone');

    this.id = IdGenerator.next('slot');
    this.name = name;
    this.bone = bone;
    this.attachments = attachments; // Map<string, Attachment>
    this.currentAttachmentName = currentAttachmentName;
    this.color = color;
    this.blendMode = blendMode;
    this.visible = visible;

    // 反向連結
    if (!bone.slots) bone.slots = [];
    bone.slots.push(this);
  }

  addAttachment(name, attachment) {
    // 確保存入的是 Attachment 實例
    this.attachments[name] = attachment instanceof Attachment ? attachment : new Attachment(attachment);
  }

  get currentAttachment() {
    return this.attachments[this.currentAttachmentName] || null;
  }
}


// ---------------------------------------------------------
// 📦 3. 骨骼系統 (Bone)
// ---------------------------------------------------------

export class Bone {
  constructor(name, headX, headY, length = 50, rotation = 0, parent = null, isConnected = true) {
    if (!name) throw new Error('Bone name required');
    
    this.id = IdGenerator.next('bone');
    this.name = name;
    this.length = Math.max(0, length);
    this.parent = parent;
    this.children = [];
    this.isConnected = isConnected;
    this.slots = []; // 存放 Slot 實例

    // === 1. Setup Pose (初始狀態) ===
    if (parent) {
      const parentT = parent.getGlobalTransform();
      const local = MathUtils.globalToLocal(headX, headY, parentT.head, parentT.rotation);
      
      this.localHead = local;
      this.localRotation = rotation - parentT.rotation;
      this.globalHead = { x: headX, y: headY };
      this.globalRotation = rotation;
    } else {
      this.localHead = { x: headX, y: headY };
      this.localRotation = rotation;
      this.globalHead = { x: headX, y: headY };
      this.globalRotation = rotation;
    }

    // === 2. Animation Pose (動畫狀態) ===
    // 初始時與 Setup Pose 相同
    this.poseHead = { ...this.localHead };
    this.poseRotation = this.localRotation;
    this.poseLength = this.length;
    
    this.poseGlobalHead = { ...this.globalHead };
    this.poseGlobalRotation = this.globalRotation;
    this.poseGlobalLength = this.length;

    // Cache
    this._globalTransformCache = null;
    this._isDirty = true;

    if (parent) {
      parent.children.push(this);
      parent._markDirty();
    }
  }

  // --- Dirty System ---
  _markDirty() {
    this._isDirty = true;
    this._globalTransformCache = null;
    this.children.forEach(c => c._markDirty());
  }

  // --- Getters (Setup Pose) ---
  getGlobalTransform() {
    if (!this._isDirty && this._globalTransformCache) {
      return this._globalTransformCache;
    }
    return this._calculateGlobalTransform();
  }

  _calculateGlobalTransform() {
    let head, rotation;

    if (!this.parent) {
      head = { ...this.localHead };
      rotation = this.localRotation;
    } else {
      const parentT = this.parent.getGlobalTransform();
      head = MathUtils.localToGlobal(this.localHead.x, this.localHead.y, parentT.head, parentT.rotation);
      rotation = parentT.rotation + this.localRotation;
    }

    const tail = {
      x: head.x + this.length * Math.cos(rotation),
      y: head.y + this.length * Math.sin(rotation)
    };

    this.globalHead = head;
    this.globalRotation = rotation;
    this._globalTransformCache = { head, tail, rotation };
    this._isDirty = false;
    
    return this._globalTransformCache;
  }

  getGlobalHead() { return this.getGlobalTransform().head; }
  getGlobalTail() { return this.getGlobalTransform().tail; }

  // --- Pose System (Animation) ---
  
  getGlobalPoseTransform() {
    // Pose 不做 Cache，因為動畫中變動頻繁
    return {
      head: { ...this.poseGlobalHead },
      tail: {
        x: this.poseGlobalHead.x + this.poseGlobalLength * Math.cos(this.poseGlobalRotation),
        y: this.poseGlobalHead.y + this.poseGlobalLength * Math.sin(this.poseGlobalRotation)
      },
      rotation: this.poseGlobalRotation,
      length: this.poseGlobalLength
    };
  }

  updatePoseGlobalTransform() {
    if (!this.parent) {
      this.poseGlobalHead = { ...this.poseHead };
      this.poseGlobalRotation = this.poseRotation;
      this.poseGlobalLength = this.poseLength;
    } else {
      const parentPose = this.parent.getGlobalPoseTransform();
      const global = MathUtils.localToGlobal(this.poseHead.x, this.poseHead.y, parentPose.head, parentPose.rotation);
      
      this.poseGlobalHead = global;
      this.poseGlobalRotation = parentPose.rotation + this.poseRotation;
      this.poseGlobalLength = this.poseLength;
    }
  }

  // --- Setters (Setup Mode) ---
  setGlobalHead(x, y) {
    const oldTail = this.getGlobalTail();
    
    // 更新 Global Head
    this.globalHead = { x, y };
    
    // 重新計算長度與角度 (維持 Tail 不動)
    const dx = oldTail.x - x;
    const dy = oldTail.y - y;
    this.length = Math.sqrt(dx*dx + dy*dy);
    this.globalRotation = Math.atan2(dy, dx);

    // 回推 Local
    if(this.parent) {
        const parentT = this.parent.getGlobalTransform();
        const local = MathUtils.globalToLocal(x, y, parentT.head, parentT.rotation);
        this.localHead = local;
        this.localRotation = this.globalRotation - parentT.rotation;
    } else {
        this.localHead = { x, y };
        this.localRotation = this.globalRotation;
    }

    // 同步更新 Pose
    this.setPoseGlobalHead(x, y);
    this._markDirty();

    // 處理子骨骼連動
    this.children.forEach(child => {
        if(child.isConnected) {
            child.setGlobalHead(this.getGlobalTail().x, this.getGlobalTail().y);
        } else {
            // 斷開連接的子骨骼，需保持視覺位置不變，更新其 Local 數據
            // (此處簡化處理，通常編輯器會重算 child local 以維持 global 不變)
            const childGlobal = child.getGlobalTransform(); // 舊的 global
            // 這裡略過複雜邏輯，視需求實作
        }
        child._markDirty();
    });
  }

  setGlobalTail(x, y) {
    const head = this.getGlobalHead();
    const dx = x - head.x;
    const dy = y - head.y;
    
    this.length = Math.sqrt(dx*dx + dy*dy);
    const newGlobalRot = Math.atan2(dy, dx);

    // Update Rotation
    if(this.parent) {
        const parentT = this.parent.getGlobalTransform();
        this.globalRotation = newGlobalRot;
        this.localRotation = newGlobalRot - parentT.rotation;
    } else {
        this.globalRotation = newGlobalRot;
        this.localRotation = newGlobalRot;
    }

    // Sync Pose
    this.setPoseGlobalTail(x, y);
    this._markDirty();

    // 處理連動的子骨骼
    const newTail = this.getGlobalTail();
    this.children.forEach(child => {
        if(child.isConnected) {
            child.setGlobalHead(newTail.x, newTail.y);
        }
    });
  }

  // --- Setters (Pose Mode) ---
  
  setPoseGlobalHead(x, y) {
    this.poseGlobalHead = { x, y };
    
    if(this.parent) {
        const parentPose = this.parent.getGlobalPoseTransform();
        const local = MathUtils.globalToLocal(x, y, parentPose.head, parentPose.rotation);
        this.poseHead = local;
    } else {
        this.poseHead = { x, y };
    }
    this._markDirty();
  }

  setPoseGlobalTail(x, y) {
    const head = this.poseGlobalHead;
    const dx = x - head.x;
    const dy = y - head.y;
    
    // Pose 操作通常不改變骨頭長度 (除非是 Stretch 模式)，這裡假設只改變旋轉
    // 但原代碼允許改變長度，我們保持一致
    // this.poseLength = Math.sqrt(dx*dx + dy*dy); 
    
    const newRot = Math.atan2(dy, dx);
    this.poseGlobalRotation = newRot;

    if(this.parent) {
        const parentPose = this.parent.getGlobalPoseTransform();
        this.poseRotation = newRot - parentPose.rotation;
    } else {
        this.poseRotation = newRot;
    }
    
    this._markDirty();
    
    // 連動子骨骼
    const newTailX = head.x + this.poseLength * Math.cos(newRot);
    const newTailY = head.y + this.poseLength * Math.sin(newRot);
    
    this.children.forEach(child => {
        if(child.isConnected) {
            child.setPoseGlobalHead(newTailX, newTailY);
        }
    });
  }

  setParent(newParent) {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx >= 0) this.parent.children.splice(idx, 1);
    }
    this.parent = newParent;
    if (newParent) newParent.children.push(this);
    this._markDirty();
  }

  resetPose(recursive = true) {
    this.poseHead = { ...this.localHead };
    this.poseRotation = this.localRotation;
    this.poseLength = this.length;
    
    if (recursive) this.children.forEach(c => c.resetPose(true));
    this._markDirty();
  }
  
  validate() {
      // 簡單循環引用檢查
      let curr = this.parent;
      while(curr) {
          if(curr === this) return [`Circular reference in ${this.name}`];
          curr = curr.parent;
      }
      return [];
  }
}


// ---------------------------------------------------------
// 📦 4. 骨架管理 (Skeleton)
// ---------------------------------------------------------

export class Skeleton {
  constructor(name = "NewSkeleton") {
    this.name = name;
    this.bones = [];
    this.boneMap = new Map();
    this.rootBones = [];
  }

  addBone(name, x, y, length = 50, rotation = 0, parent = null, isConnected = true) {
    if (!name) name = `Bone_${this.bones.length + 1}`;
    if (this.boneMap.has(name)) throw new Error(`Bone "${name}" exists`);

    const bone = new Bone(name, x, y, length, rotation, parent, isConnected);
    this.bones.push(bone);
    this.boneMap.set(name, bone);
    this.updateRootBones();
    return bone;
  }

  getBone(name) { return this.boneMap.get(name); }

  removeBone(name) {
    const bone = this.getBone(name);
    if (!bone) return false;

    // 處理 Parent
    if (bone.parent) {
      const idx = bone.parent.children.indexOf(bone);
      if (idx >= 0) bone.parent.children.splice(idx, 1);
    }
    
    // 處理 Children (將子骨骼掛到被刪除骨骼的父層，或變為 Root)
    const newParent = bone.parent;
    bone.children.forEach(child => child.setParent(newParent));

    this.bones = this.bones.filter(b => b !== bone);
    this.boneMap.delete(name);
    this.updateRootBones();
    return true;
  }

  updateRootBones() {
    this.rootBones = this.bones.filter(b => !b.parent);
  }

  update() {
    // 這裡通常呼叫 Animation System 更新
    this.rootBones.forEach(root => this._updateRecursive(root));
  }

  _updateRecursive(bone) {
    bone.updatePoseGlobalTransform(); // 更新 Pose
    bone.getGlobalTransform();        // 更新 Setup Pose Cache
    bone.children.forEach(c => this._updateRecursive(c));
  }

  forEachBone(cb) { this.bones.forEach(cb); }

  // === Export Logic (Spine Format) ===
  exportSpineJson(scale = 100) {
    // 確保有 Root
    const exportBones = [...this.bones];
    if(!exportBones.find(b => !b.parent && b.name === 'root')) {
        // Spine 習慣有一個名為 root 的原點骨骼，若無可虛擬一個或直接匯出
    }

    const spineBones = exportBones.map(b => ({
        name: b.name,
        parent: b.parent ? b.parent.name : null,
        length: b.length * scale,
        x: b.localHead.x * scale,
        y: b.localHead.y * scale,
        rotation: MathUtils.radToDeg(b.localRotation),
        color: 'ffffffff' // Default color
    })).filter(b => b); // Remove nulls if any

    // 簡單的 Slot 輸出 (每個骨骼一個 Slot)
    const spineSlots = exportBones.map(b => ({
        name: b.name,
        bone: b.name,
        attachment: b.name
    }));

    // Skins (Placeholder)
    const spineSkins = [{
        name: "default",
        attachments: {}
    }];

    // 填入 Attachments
    exportBones.forEach(b => {
        // 這裡假設每個 Slot 有一個同名的 Attachment
        spineSkins[0].attachments[b.name] = {
            [b.name]: {
                type: "region",
                x: b.length / 2 * scale, // 假設圖片中心在骨骼中間
                y: 0,
                scaleX: 1, scaleY: 1,
                rotation: 0,
                width: 100, height: 100 // 預設值
            }
        };
    });

    return {
        skeleton: { spine: "4.1.0", x: 0, y: 0, width: 0, height: 0 },
        bones: spineBones,
        slots: spineSlots,
        skins: spineSkins
    };
  }

  exportToFile(filename = "skeleton.json", scale = 100) {
    const data = this.exportSpineJson(scale);
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}


// ---------------------------------------------------------
// 📦 5. 網格與專案 (Mesh2D, Project2D)
// ---------------------------------------------------------

export class VertexGroup {
  constructor(name, bone = null) {
    this.name = name;
    this.bone = bone;
    this.vertices = []; // { id: vertexIndex, weight: 0..1 }
  }
}

export class Mesh2D {
  constructor(name = "NewMesh") {
    this.name = name;
    this.vertices = []; // Array<Vertex>
    this.indices = [];
    this.groups = {}; // Map<string, VertexGroup>
    
    // Rendering Props
    this.image = null;
    this.visible = true;
    this.layers = []; 
    
    // WebGL Buffers (Runtime)
    this.vbo = null;
    this.ebo = null;
    this.eboLines = null;
  }

  addVertex(x, y) {
    const v = new Vertex(x, y);
    this.vertices.push(v);
    return v;
  }

  addGroup(name, bone = null) {
    if (!this.groups[name]) {
      this.groups[name] = new VertexGroup(name, bone);
    }
    return this.groups[name];
  }

  getGroup(name) { return this.groups[name]; }

  clone(prefix = "Copy_") {
    const copy = new Mesh2D(prefix + this.name);
    copy.vertices = this.vertices.map(v => v.clone());
    copy.indices = [...this.indices]; // Shallow copy of array (integers)
    // Groups need deep copy logic if needed
    return copy;
  }
}

export class Project2D {
  constructor(name = "Project") {
    this.name = name;
    this.meshes = [];
    this.skeletons = [];
  }
  
  addSkeleton(name) {
      const skel = new Skeleton(name);
      this.skeletons.push(skel);
      return skel;
  }
  
  addMesh(name) {
      const mesh = new Mesh2D(name);
      this.meshes.push(mesh);
      return mesh;
  }
}

// ---------------------------------------------------------
// 📦 6. 互動檢測工具
// ---------------------------------------------------------

export function getClosestBoneAtClick(skeleton, clickX, clickY, isCreateMode = true, radius = 10) {
  let best = null;
  let minDiff = Infinity;

  skeleton.forEachBone(bone => {
    // 根據模式選擇 Transform
    const t = isCreateMode ? bone.getGlobalTransform() : bone.getGlobalPoseTransform();
    const head = t.head;
    const tail = t.tail;

    // Check Head
    const dHead = MathUtils.distance(clickX, clickY, head.x, head.y);
    if (dHead < radius && dHead < minDiff) {
      minDiff = dHead;
      // 若有 Parent 且相連，點擊 Head 視為選中 Parent 的 Tail
      if (bone.isConnected && bone.parent) {
         best = { bone: bone.parent, type: 'tail', distance: dHead };
      } else {
         best = { bone: bone, type: 'head', distance: dHead };
      }
      bone.offsetX = clickX - head.x;
      bone.offsetY = clickY - head.y;
    }

    // Check Tail
    const dTail = MathUtils.distance(clickX, clickY, tail.x, tail.y);
    if (dTail < radius && dTail < minDiff) {
      minDiff = dTail;
      best = { bone: bone, type: 'tail', distance: dTail };
      bone.offsetX = clickX - head.x; // Offset relative to head usually
      bone.offsetY = clickY - head.y;
    }

    // Check Body (Middle)
    if (!best) {
        const dBody = MathUtils.distanceToLineSegment(clickX, clickY, head.x, head.y, tail.x, tail.y);
        if (dBody < radius && dBody < minDiff) {
            minDiff = dBody;
            best = { bone: bone, type: 'middle', distance: dBody };
            bone.offsetX = clickX - head.x;
            bone.offsetY = clickY - head.y;
        }
    }
  });

  return best;
}