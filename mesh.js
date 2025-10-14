// mesh.js

/**
 * 頂點類 - 表示網格中的一個頂點
 */
export class Vertex {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.groups = {}; // { groupName: weight }
    this.poseX = x; // 動畫用的 pose 座標
    this.poseY = y;
  }

  /**
   * 設定頂點在指定群組中的權重
   */
  setWeight(groupName, weight) {
    if (weight <= 0) {
      this.removeWeight(groupName);
      return;
    }
    this.groups[groupName] = Math.max(0, Math.min(1, weight)); // 限制在 0-1 範圍
  }

  /**
   * 移除頂點在指定群組中的權重
   */
  removeWeight(groupName) {
    delete this.groups[groupName];
  }

  /**
   * 取得頂點在指定群組中的權重
   */
  getWeight(groupName) {
    return this.groups[groupName] || 0;
  }

  /**
   * 取得所有權重的總和
   */
  getTotalWeight() {
    return Object.values(this.groups).reduce((sum, weight) => sum + weight, 0);
  }

  /**
   * 正規化所有權重，使總和為 1
   */
  /**
   * 重置頂點的 pose 位置到原始位置
   */
  resetPose() {
    this.poseX = this.x;
    this.poseY = this.y;
  }

  normalizeWeights() {
    const total = this.getTotalWeight();
    if (total === 0) return;

    for (const groupName in this.groups) {
      this.groups[groupName] /= total;
    }
  }

  /**
   * 複製頂點
   */
  clone() {
    const vertex = new Vertex(this.x, this.y);
    vertex.groups = { ...this.groups };
    return vertex;
  }
}

/**
 * 骨骼類 - 表示骨架中的一根骨骼
 */

let globalBoneId = 0;
export class Bone {
  constructor(name, headX, headY, length = 50, rotation = 0, parent = null, isConnected = true) {
    console.log("Bone constructor got:", name, typeof name);
    if (!name || typeof name !== 'string') {
      throw new Error('Bone name must be a non-empty string');
    }
    this.id = `${name}_${globalBoneId++}`;
    this.name = name;
    this.children = []; // Initialize children array
    this.length = Math.max(0, length);
    this.parent = parent;
    this.isConnected = isConnected;
    this.slot = []; // slot is spine2d's concept, a bone can have one slot to attach image, maybe not the same as out architecture

    // 新增 local/global head/rotation
    if (parent) {
      console.log("Bone constructor parent:", parent.name);
      const parentTransform = parent.getGlobalTransform();
      const local = this._globalToLocal(headX, headY, parentTransform);

      //parameter define: local is relative to parent head , global is world space
      this.localHead = { x: local.x, y: local.y };
      this.localRotation = rotation - parentTransform.rotation;
      this.globalHead = { x: headX, y: headY };
      this.globalRotation = rotation;

      // 初始化 pose 相關屬性 base on relative to parent's pose
      this.poseGlobalHead = { x: headX, y: headY };
      this.poseGlobalRotation = rotation;
      this.poseGlobalLength = length;
      this.poseHead = { x: local.x, y: local.y };
      this.poseRotation = rotation - parentTransform.rotation;
      this.poseLength = length;


    } else {
      this.localHead = { x: headX, y: headY };
      this.localRotation = rotation;
      this.globalHead = { x: headX, y: headY };
      this.globalRotation = rotation;

      // 初始化 pose 相關屬性
      this.poseHead = { x: headX, y: headY };
      this.poseRotation = rotation;
      this.poseLength = length;

      // last recorded global pose infos, for child bone update use
      this.poseGlobalHead = { x: headX, y: headY };
      this.poseGlobalRotation = rotation;
      this.poseGlobalLength = length;

    }


    // 快取相關
    this._globalTransformCache = null;
    this._isDirty = true;

    if (parent) {
      parent.children.push(this);
      parent._markDirty();
    }
  }

  /**
   * 標記為需要重新計算（dirty）
   */
  _markDirty() {
    this._isDirty = true;
    this._globalTransformCache = null;
    // 遞迴標記所有子骨骼
    this.children.forEach(child => child._markDirty());
  }

  /**
   * 座標轉換：本地座標轉全域座標
   */
  _localToGlobal(localX, localY, parentTransform) {
    if (!parentTransform) return { x: localX, y: localY };

    const cos = Math.cos(parentTransform.rotation);
    const sin = Math.sin(parentTransform.rotation);

    // 以父骨骼的頭部為基準點進行旋轉和平移
    return {
      x: parentTransform.head.x + (localX * cos - localY * sin),
      y: parentTransform.head.y + (localX * sin + localY * cos)
    };
  }

  /**座標轉換：全域座標轉本地座標*/
  _globalToLocal(globalX, globalY, parentTransform) {
    if (!parentTransform) return { x: globalX, y: globalY };

    // 先將點相對於父骨骼頭部進行平移
    const dx = globalX - parentTransform.head.x;
    const dy = globalY - parentTransform.head.y;

    // 反向旋轉
    const cos = Math.cos(-parentTransform.rotation);
    const sin = Math.sin(-parentTransform.rotation);

    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos
    };
  }

  /**
   * 取得本地 head 位置
   */
  getLocalHead() {
    return { x: this.localHead.x, y: this.localHead.y };
  }

  /**
   * 取得本地 tail 位置
   */
  getLocalTail() {
    return {
      x: this.localHead.x + this.length * Math.cos(this.localRotation),
      y: this.localHead.y + this.length * Math.sin(this.localRotation)
    };
  }

  /**
   * 取得全域 head 位置
   */
  getGlobalHead() {
    return { x: this.globalHead.x, y: this.globalHead.y };
  }

  /**
   * 取得全域 tail 位置
   */
  getGlobalTail() {
    return {
      x: this.globalHead.x + this.length * Math.cos(this.globalRotation),
      y: this.globalHead.y + this.length * Math.sin(this.globalRotation)
    };
  }

  /**
   * 設定長度
   */
  setLength(newLength) {
    this.length = Math.max(0, newLength);
    this._markDirty();
  }

  /**
   * 設定旋轉角度
   */
  setRotation(newRotation) {
    this.localRotation = newRotation;
    this.poseRotation = newRotation; // 同步更新 pose 旋轉
    this._markDirty();
  }

  /**
   * 設定動畫用的 pose 旋轉角度
   */
  setPoseRotation(newRotation) {
    this.poseRotation = newRotation;
    this._markDirty();
  }

  /**
   * 獲取當前 pose 旋轉角度
   */
  getPoseRotation() {
    return this.poseRotation !== undefined ? this.poseRotation : this.localRotation;
  }


  //get caculated global pose transform for child bone use
  getGlobalPoseTransform() {
    return {
      head: { x: this.poseGlobalHead.x, y: this.poseGlobalHead.y },
      rotation: this.poseGlobalRotation,
      length: this.poseGlobalLength,
      //also caculate tail if needed
      tail: {
        x: this.poseGlobalHead.x + this.poseGlobalLength * Math.cos(this.poseGlobalRotation),
        y: this.poseGlobalHead.y + this.poseGlobalLength * Math.sin(this.poseGlobalRotation)
      }
    };
  }


  //update current poseGlobal transform based on parent's poseGlobal , in order to draw world space pose
  updatePoseGlobalTransform() {
    if (!this.parent) {
      //if no parent , poseGlobal is same as global head

      this.poseGlobalHead = { x: this.poseHead.x, y: this.poseHead.y };
      this.poseGlobalRotation = this.poseRotation;
      this.poseGlobalLength = this.poseLength;
    }
    else {
      const parentPoseTransform = this.parent.getGlobalPoseTransform();
      // caculate this bone's poseGlobalHead from localHead and parent's poseGlobal
      //check poseHead console


      const local = this._localToGlobal(this.poseHead.x, this.poseHead.y, parentPoseTransform);
      this.poseGlobalHead = { x: local.x, y: local.y };
      this.poseGlobalRotation = parentPoseTransform.rotation + this.poseRotation;
      this.poseGlobalLength = this.poseLength;


    }
    //update all children too (maybe not needed here, because skeleton update will call this again)
    // this.children.forEach(child => child.updatePoseGlobalTransform());

  }


  /**
   * 設定本地 head 偏移
   */
  setLocalHead(x, y) {
    this.localHead.x = x;
    this.localHead.y = y;
    this._markDirty();
  }

  /**
   * 獲取當前 pose head 位置
   */
  getPoseHead() {
    return {
      x: this.poseHead ? this.poseHead.x : this.localHead.x,
      y: this.poseHead ? this.poseHead.y : this.localHead.y
    };
  }

  /**
   * 設定 pose 長度
   */
  setPoseLength(length) {
    this.poseLength = Math.max(0, length);
    this._markDirty();
  }

  /**
   * 獲取當前 pose 長度
   */
  getPoseLength() {
    return this.poseLength !== undefined ? this.poseLength : this.length;
  }
  setHeadOnly(x, y) {
    const oldTail = this.getLocalTail();
    this.localHead.x = x;
    this.localHead.y = y;
    this.length = Math.sqrt(
      Math.pow(oldTail.x - x, 2) + Math.pow(oldTail.y - y, 2)
    );
    this.localRotation = Math.atan2(oldTail.y - y, oldTail.x - x);
    this._markDirty();
  }
  /**
   * 設定本地 tail，並更新 length 與 rotation
   */
  setLocalTail(x, y) {
    const dx = x - this.localHead.x;
    const dy = y - this.localHead.y;
    this.length = Math.sqrt(dx * dx + dy * dy);
    this.localRotation = Math.atan2(dy, dx);
    this._markDirty();
  }

  /**
   * 設定全域 head（會轉回本地座標）
   */
  /**
   * 重置骨骼的 pose 狀態到原始位置
   * @param {boolean} recursive - 是否遞迴重置所有子骨骼
   */
  resetPose(recursive = true) {
    //console.log(" hi reset pose!");
    // 重置 pose 屬性到原始狀態
    this.poseHead = {
      x: this.localHead.x,
      y: this.localHead.y
    };
    this.poseRotation = this.localRotation;
    this.poseLength = this.length;

    // 如果需要遞迴重置，處理所有子骨骼
    if (recursive && this.children) {
      this.children.forEach(child => {
        child.resetPose(true);
      });
    }

    this._markDirty();
  }

  setGlobalHead(x, y) {
    // 保存原始尾部位置
    const originalTail = this.getGlobalTail();

    // 保存所有子骨骼的原始全域位置和旋轉
    const childrenGlobalInfo = this.children.map(child => ({
      bone: child,
      headPos: child.getGlobalHead(),
      tailPos: child.getGlobalTail(),
      rotation: child.globalRotation
    }));

    // 設定當前骨骼的新全域頭部位置
    this.globalHead.x = x;
    this.globalHead.y = y;

    // 根據新的頭部位置和原始尾部位置計算新的長度和旋轉
    const dx = originalTail.x - x;
    const dy = originalTail.y - y;
    this.length = Math.sqrt(dx * dx + dy * dy);
    this.globalRotation = Math.atan2(dy, dx);

    // 計算新的本地座標
    if (this.parent) {
      const parentTransform = this.parent.getGlobalTransform();
      const local = this._globalToLocal(x, y, parentTransform);
      this.localHead.x = local.x;
      this.localHead.y = local.y;
      this.localRotation = this.globalRotation - parentTransform.rotation;
    } else {
      this.localHead.x = x;
      this.localHead.y = y;
      this.localRotation = this.globalRotation;
    }

    //update global pose too
    this.setPoseGlobalHead(x, y);



    // 標記需要更新
    this._markDirty();

    // 更新子骨骼位置
    childrenGlobalInfo.forEach(({ bone, headPos, tailPos, rotation }) => {
      if (bone.isConnected) {
        // 如果是連接的子骨骼，需要跟隨父骨骼的尾部
        const parentTail = this.getGlobalTail();
        bone.setGlobalHead(parentTail.x, parentTail.y);
        bone.setPoseGlobalHead(parentTail.x, parentTail.y);
      } else {
        // 如果不是連接的子骨骼，保持其原始全域位置
        //  bone.setPoseGlobalHead(headPos.x, headPos.y);
      }

      // 重新設定子骨骼的全域旋轉
      const parentTransform = bone.parent.getGlobalTransform();
      bone.globalRotation = rotation;
      bone.localRotation = rotation - parentTransform.rotation;
      bone._markDirty();
    });
  }

  //seting global head for animation pose use, tail and children's coordinates will move together
  setPoseGlobalHead(x, y) {

    this.poseGlobalHead.x = x;
    this.poseGlobalHead.y = y;

    //update local pose head based on parent's poseGlobal
    if (this.parent) {
      const parentPoseTransform = this.parent.getGlobalPoseTransform();
      const local = this._globalToLocal(x, y, parentPoseTransform);
      this.poseHead.x = local.x;
      this.poseHead.y = local.y;
    } else {
      this.poseHead.x = x;
      this.poseHead.y = y;
    }

    this._markDirty();
  }



  setPoseGlobalTail(x, y) {
    // 取得目前骨頭的 head 與原本長度
    const head = this.getGlobalPoseTransform().head;
    const tail = this.getGlobalPoseTransform().tail;
    const origLength = this.poseLength; // 保持原本長度

    // 計算新的方向 (由 head 指向新 tail)
    const dx = x - head.x;
    const dy = y - head.y;
    const newGlobalRot = Math.atan2(dy, dx);

    // 更新 rotation，但不要改變長度
    if (this.parent) {
      const parentTransform = this.parent.getGlobalPoseTransform();
      this.poseRotation = newGlobalRot - parentTransform.rotation;
      this.poseGlobalRotation = newGlobalRot;
    } else {
      this.poseRotation = newGlobalRot;
      this.poseGlobalRotation = newGlobalRot;
    }

    // 保持 head 不動、長度不變
    this.poseLength = origLength;
    this.poseGlobalHead = { ...head };

    this._markDirty();

    // 取得更新後的 global tail（用新的 rotation 計算）
    const newTailX = head.x + Math.cos(this.poseGlobalRotation) * origLength;
    const newTailY = head.y + Math.sin(this.poseGlobalRotation) * origLength;

    // 讓子骨頭的 head 附著在新的 tail 上
    this.children.forEach(child => {
      if (child.isConnected) {
        child.setPoseGlobalHead(newTailX, newTailY);
        child._markDirty();
      }
    });
  }

  /**
   * 直接設定骨骼的全域尾部位置，用於姿勢
   */
  poseGlobalTail(x, y) {
    // 儲存所有連接的子骨骼的原始尾部位置
    const childrenOriginalTails = this.children
      .filter(child => child.isConnected)
      .map(child => ({
        bone: child,
        tail: child.getGlobalTail()
      }));

    // 計算新的長度和旋轉
    const head = this.getGlobalHead();
    const dx = x - head.x;
    const dy = y - head.y;
    this.length = Math.sqrt(dx * dx + dy * dy);

    if (this.parent) {
      const parentTransform = this.parent.getGlobalTransform();
      // this.localRotation = Math.atan2(dy, dx) - parentTransform.rotation;
      // this.globalRotation = Math.atan2(dy, dx);
    } else {
      //this.localRotation = Math.atan2(dy, dx);
      //  this.globalRotation = this.localRotation;
    }

    // 標記需要更新
    this._markDirty();

    // 更新所有連接的子骨骼位置
    childrenOriginalTails.forEach(({ bone: childBone, tail }) => {
      // 設置子骨骼的頭部到當前骨骼的新尾部位置
      const newHead = { x, y };
      childBone.setPoseGlobalHead(newHead.x, newHead.y);

      // 計算並設置子骨骼的新角度和長度，以保持尾部在原位
      const tailDx = tail.x - newHead.x;
      const tailDy = tail.y - newHead.y;
      childBone.length = Math.sqrt(tailDx * tailDx + tailDy * tailDy);
      //childBone.globalRotation = Math.atan2(tailDy, tailDx);

      // 更新本地旋轉角度
      if (childBone.parent) {
        childBone.localRotation = childBone.globalRotation - childBone.parent.globalRotation;
      } else {
        childBone.localRotation = childBone.globalRotation;
      }

      childBone._markDirty();
    });
  }

  /**
   * 設定全域尾部位置，會影響到連接的子骨骼
   */
  setGlobalTail(x, y) {
    console.log(" setGlobalTail called with:", x, y);
    // 儲存所有子骨骼的原始全域尾部位置
    const childrenOriginalTails = this.children
      .filter(child => child.isConnected)
      .map(child => ({
        bone: child,
        tail: child.getGlobalTail()
      }));

    // 計算新的長度和旋轉
    const head = this.getGlobalHead();
    const dx = x - head.x;
    const dy = y - head.y;
    this.length = Math.sqrt(dx * dx + dy * dy);

    this.setPoseGlobalTail(x, y); // also update pose tail and related infos


    if (this.parent) {
      const parentTransform = this.parent.getGlobalTransform();
      this.localRotation = Math.atan2(dy, dx) - parentTransform.rotation;
      this.globalRotation = Math.atan2(dy, dx);
    } else {
      this.localRotation = Math.atan2(dy, dx);
      this.globalRotation = this.localRotation;
    }

    // 標記需要更新
    this._markDirty();

    // update first layer's child pose tail if connected
    childrenOriginalTails.forEach(({ bone: childBone, tail }) => {
      if (childBone.isConnected) {
        //set child's head to this bone's new tail position
        const newHead = this.getGlobalTail();
        childBone.setGlobalHead(newHead.x, newHead.y);
        childBone.setGlobalTail(tail.x, tail.y); // keep original tail position
        childBone.setPoseGlobalHead(newHead.x, newHead.y);
        childBone.setPoseGlobalTail(tail.x, tail.y); // keep original tail position


        childBone._markDirty();
      }
    });


  }

  /**
   * 計算全域變換（帶快取）
   */
  getGlobalTransform() {
    if (!this._isDirty && this._globalTransformCache) {
      return this._globalTransformCache;
    }
    this._globalTransformCache = this._calculateGlobalTransform();
    this._isDirty = false;
    return this._globalTransformCache;
  }

  getLocalTransform() {
    return {
      head: { x: this.localHead.x, y: this.localHead.y },
      tail: {
        x: this.localHead.x + this.length * Math.cos(this.localRotation),
        y: this.localHead.y + this.length * Math.sin(this.localRotation)
      },
      rotation: this.localRotation
    };
  }

  //get pose transform for animation use
  getPoseTransform() {
    const head = this.getPoseHead();
    const length = this.getPoseLength();
    const rotation = this.getPoseRotation();
    const tail = {
      x: head.x + length * Math.cos(rotation),
      y: head.y + length * Math.sin(rotation)
    };

    return { head, tail, rotation };
  }  // tips: getPoseTransform is not cached, because pose can change frequently during animation 



  /**
   * 實際計算全域變換
   */
  _calculateGlobalTransform() {
    if (!this.parent) {
      const head = { x: this.localHead.x, y: this.localHead.y };
      const tail = {
        x: head.x + this.length * Math.cos(this.localRotation),
        y: head.y + this.length * Math.sin(this.localRotation)
      };
      this.globalHead = { ...head };
      this.globalRotation = this.localRotation;
      return { head, tail, rotation: this.localRotation };
    }

    // 取得父骨骼的全域變換
    const parentTransform = this.parent.getGlobalTransform();

    // 計算全域頭部位置
    const globalHead = this._localToGlobal(this.localHead.x, this.localHead.y, parentTransform);

    // 計算全域旋轉角度
    const totalRotation = parentTransform.rotation + this.localRotation;

    // 計算全域尾部位置
    const tail = {
      x: globalHead.x + this.length * Math.cos(totalRotation),
      y: globalHead.y + this.length * Math.sin(totalRotation)
    };

    // 更新骨骼的全域屬性
    this.globalHead = { ...globalHead };
    this.globalRotation = totalRotation;

    return {
      head: globalHead,
      tail: tail,
      rotation: totalRotation
    };
  }

  /**
   * 設定父骨骼
   */
  setParent(newParent) {
    // 從舊父骨骼移除
    if (this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) {
        this.parent.children.splice(index, 1);
      }
    }

    // 設定新父骨骼
    this.parent = newParent;
    if (newParent) {
      newParent.children.push(this);
    }

    this._markDirty();
  }

  /**
   * 取得所有子代骨骼（遞迴）
   */
  getDescendants() {
    const descendants = [];
    const traverse = (bone) => {
      bone.children.forEach(child => {
        descendants.push(child);
        traverse(child);
      });
    };
    traverse(this);
    return descendants;
  }

  /**
   * 取得根骨骼
   */
  getRoot() {
    let current = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  /**
   * 複製骨骼（可選是否深複製子骨骼）
   */
  clone(deep = false, namePrefix = 'Copy_') {
    const copy = new Bone(
      namePrefix + this.name,
      this.localHead.x,
      this.localHead.y,
      this.length,
      this.localRotation,
      null,
      this.blenderMode
    );

    if (deep) {
      for (const child of this.children) {
        const childCopy = child.clone(true, namePrefix);
        childCopy.setParent(copy);
      }
    }

    return copy;
  }

  /**
   * 驗證骨骼結構是否有效
   */
  validate() {
    const errors = [];

    // 檢查是否有循環引用
    const visited = new Set();
    let current = this;
    while (current) {
      if (visited.has(current)) {
        errors.push(`Circular reference detected in bone: ${this.name}`);
        break;
      }
      visited.add(current);
      current = current.parent;
    }

    return errors;
  }
}

/**
 * 骨架類
 */export class Skeleton {
  constructor(name = "") {
    this.name = name;
    this.bones = [];
    this.boneMap = new Map(); // 快速查找
    this.rootBones = []; // 根骨骼列表
    this.autoBoneCounter = 1; // 自動命名計數器
  }


  exportSpineJson(scale = 100) {
    if (this.bones.length === 0) {
      this.bones.push({ name: "root", localHead: { x: 0, y: 0 }, length: 0, localRotation: 0 });
    }

    const rootBones = this.bones.filter(b => !b.parent);
    if (rootBones.length === 0) {
      this.bones.unshift({ name: "root", localHead: { x: 0, y: 0 }, length: 0, localRotation: 0 });
    }

    // 🦴 bones
    const spineBones = this.bones.map(bone => {
      const boneData = {
        name: bone.name,
        x: (bone.localHead?.x ?? 0) * scale,
        y: (bone.localHead?.y ?? 0) * scale,
        rotation: bone.localRotation ?? 0,
        length: (bone.length ?? 0) * scale,
        color: "ffffffff"
      };
      if (bone.parent) boneData.parent = bone.parent.name;
      return boneData;
    });

    // 📏 計算骨架範圍
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const bone of this.bones) {
      const x0 = (bone.localHead?.x ?? 0) * scale;
      const y0 = (bone.localHead?.y ?? 0) * scale;
      const rad = (bone.localRotation ?? 0) * (Math.PI / 180);
      const x1 = x0 + (bone.length ?? 0) * scale * Math.cos(rad);
      const y1 = y0 + (bone.length ?? 0) * scale * Math.sin(rad);
      minX = Math.min(minX, x0, x1);
      minY = Math.min(minY, y0, y1);
      maxX = Math.max(maxX, x0, x1);
      maxY = Math.max(maxY, y0, y1);
    }

    if (!isFinite(minX)) minX = 0;
    if (!isFinite(minY)) minY = 0;
    if (!isFinite(maxX)) maxX = 0;
    if (!isFinite(maxY)) maxY = 0;

    const width = maxX - minX;
    const height = maxY - minY;

    // 🎨 slots （每個骨頭自動有一個 slot）
    const spineSlots = this.bones.map(bone => ({
      name: `${bone.name}`,
      bone: bone.name,
      attachment: bone.name,
      color: "ffffffff",
      blend: "normal"
    }));

    // 🧩 skins 與 attachments（新版陣列格式）
    const attachments = {};
    for (const bone of this.bones) {
      const slotName = `${bone.name}`;
      const attachmentName = bone.name;
      attachments[slotName] = {
        [attachmentName]: {
          type: "region",
          name: attachmentName + 'aa',
          x: (bone.localHead?.x ?? 0) * scale,
          y: (bone.localHead?.y ?? 0) * scale,
          rotation: bone.localRotation ?? 0,
          width: 500,
          height: 768,
          color: "ffffffff"
        }
      };
    }

    // 🧬 組合完整 Spine JSON
    return {
      skeleton: {
        hash: Math.random().toString(36).substring(2, 12),
        spine: "4.1.17",
        x: minX,
        y: minY,
        width: 500,
        height: 768,
        images: "./images/",
        audio: ""
      },
      bones: spineBones,
      slots: spineSlots,
      skins: [
        {
          name: "default",
          attachments
        }
      ],
      animations: {
        default: {
          bones: {},
          slots: {}
        }
      }
    };
  }

  /**
  * 將 Spine JSON 匯出成檔案
  * @param {string} filename - 檔案名稱（預設 skeleton.json）
  * @param {number} scale - 輸出比例
  */
  exportToFile(filename = "skeleton.json", scale = 100) {
    const data = this.exportSpineJson(scale);
    const jsonStr = JSON.stringify(data, null, 2);

    // 🖥️ Node.js 環境
    if (typeof window === "undefined") {
      const fs = require("fs");
      fs.writeFileSync(filename, jsonStr, "utf-8");
      console.log(`✅ 已輸出 Spine JSON 檔案：${filename}`);
      return;
    }

    // 🌐 Browser 環境
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`✅ 已在瀏覽器觸發下載：${filename}`);

  }
  /**
   * 產生 Spine Atlas 檔案
   * @param {string} filename - 輸出檔名，預設 skeleton.atlas
   * @param {string} imageName - Atlas 中的 png 檔名
   * @param {object} imageSize - png 尺寸 { width, height }
   * @param {object} regions - 每個 region 的 bounds (選填)
   *   格式: { regionName: { x, y, width, height } }
   */
  exportAtlasFile(
    filename = "skeleton.atlas",
    imageName = "alien.png",
    imageSize = { width: 500, height: 768 },
    regions = {}
  ) {
    if (this.bones.length === 0) {
      console.warn("⚠️ 沒有骨骼資料，Atlas 會空白");
    }

    // Atlas 內容字串
    let atlasContent = `${imageName}\n`;
    atlasContent += `\tsize: ${imageSize.width}, ${imageSize.height}\n`;
    atlasContent += `\tfilter: Linear, Linear\n`;

    // 產生每個 region
    for (const bone of this.bones) {
      const regionName = bone.name;
      const bound =
        regions[regionName] || {
          x: 0,
          y: 0,
          width: imageSize.width,
          height: imageSize.height,
        };
      atlasContent += `${regionName}aa\n`;
      atlasContent += `\tbounds: ${bound.x}, ${bound.y}, ${bound.width}, ${bound.height}\n`;
    }

    // 🔧 移除最後多餘的換行與空白
    atlasContent = atlasContent.trimEnd();

    // 🖥️ Node.js 環境
    if (typeof window === "undefined") {
      const fs = require("fs");
      fs.writeFileSync(filename, atlasContent, "utf-8");
      console.log(`✅ 已輸出 Atlas 檔案：${filename}`);
      return;
    }

    // 🌐 Browser 環境
    const blob = new Blob([atlasContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`✅ 已在瀏覽器觸發下載 Atlas：${filename}`);
  }

  updateRootBones() {
    this.rootBones = this.bones.filter(bone => !bone.parent);
  }
  // 更新所有骨骼的全局變換
  updateGlobalTransforms() {
    // 使用已經存在的根骨骼列表
    const rootBones = this.rootBones.length > 0 ? this.rootBones : this.bones.filter(bone => !bone.parent);

    // 遞迴更新每個骨骼的全局變換
    const updateBoneTransform = (bone) => {
      if (bone.parent) {
        // 有父骨骼的情況：計算全局變換
        const parentTransform = bone.parent.getGlobalTransform();

        // 計算全局頭部位置
        const globalHead = bone._localToGlobal(
          bone.localHead.x,
          bone.localHead.y,
          parentTransform
        );
        bone.globalHead.x = globalHead.x;
        bone.globalHead.y = globalHead.y;

        // 計算全局旋轉
        bone.globalRotation = parentTransform.rotation + bone.localRotation;
      } else {
        // 根骨骼：本地就是全局
        bone.globalHead.x = bone.localHead.x;
        bone.globalHead.y = bone.localHead.y;
        bone.globalRotation = bone.localRotation;
      }

      // 更新變換緩存
      bone._globalTransformCache = {
        head: { x: bone.globalHead.x, y: bone.globalHead.y },
        rotation: bone.globalRotation
      };

      // 遞迴處理所有子骨骼
      bone.children.forEach(child => updateBoneTransform(child));
    };

    // 從每個根骨骼開始更新
    rootBones.forEach(rootBone => updateBoneTransform(rootBone));
  }

  /**
   * 產生唯一骨骼名稱
   */
  _generateBoneName(base = "Bone") {
    let name;
    do {
      name = `${base}_${this.autoBoneCounter++}`;
    } while (this.boneMap.has(name));
    return name;
  }

  /**
   * 添加骨骼
   */
  addBone(name, x, y, length = 50, rotation = 0, parent = null, blenderMode = true) {
    // 如果沒有傳入 name，產生一個自動名稱
    if (!name || name.trim() === "") {
      name = this._generateBoneName();
    }

    if (this.boneMap.has(name)) {
      throw new Error(`Bone with name "${name}" already exists`);
    }

    const bone = new Bone(name, x, y, length, rotation, parent, blenderMode);
    this.bones.push(bone);
    this.boneMap.set(name, bone);

    if (!parent) {
      this.rootBones.push(bone);
    }

    this.updateRootBones(); // 確保根骨骼列表是最新的

    return bone;
  }

  /**
   * 取得骨骼
   */
  getBone(name) {
    return this.boneMap.get(name);
  }

  /**
   * 移除骨骼
   */
  removeBone(name) {
    const bone = this.getBone(name);
    if (!bone) return false;

    // 移除父子關係
    if (bone.parent) {
      const index = bone.parent.children.indexOf(bone);
      if (index >= 0) bone.parent.children.splice(index, 1);
    } else {
      const index = this.rootBones.indexOf(bone);
      if (index >= 0) this.rootBones.splice(index, 1);
    }

    // 重新設定子骨骼的父骨骼為此骨骼的父骨骼
    bone.children.forEach(child => {
      child.setParent(bone.parent);
    });

    // 移除自身
    const boneIndex = this.bones.indexOf(bone);
    if (boneIndex >= 0) this.bones.splice(boneIndex, 1);
    this.boneMap.delete(name);

    return true;
  }

  /**
   * 重新命名骨骼
   */
  renameBone(oldName, newName) {
    if (this.boneMap.has(newName)) {
      throw new Error(`Bone with name "${newName}" already exists`);
    }

    const bone = this.getBone(oldName);
    if (!bone) return false;

    this.boneMap.delete(oldName);
    bone.name = newName;
    this.boneMap.set(newName, bone);

    return true;
  }

  /**
   * 取得所有根骨骼
   */
  getRootBones() {
    return [...this.rootBones];
  }

  /**
   * 遍歷所有骨骼
   */
  forEachBone(callback) {
    this.bones.forEach(callback);
  }

  /**
   * 驗證骨架結構
   */
  validate() {
    const errors = [];

    this.bones.forEach(bone => {
      const boneErrors = bone.validate();
      errors.push(...boneErrors);
    });

    return errors;
  }

  /**
   * 複製骨架
   */
  clone(namePrefix = "Copy_") {
    const copy = new Skeleton(namePrefix + this.name);
    const boneMapping = new Map(); // 舊骨骼 -> 新骨骼的映射

    // 第一遍：複製所有骨骼（不設定父子關係）
    this.bones.forEach(bone => {
      const boneCopy = new Bone(
        bone.name,
        bone.localHead.x,
        bone.localHead.y,
        bone.length,
        bone.localRotation,
        null,
        bone.blenderMode
      );
      boneMapping.set(bone, boneCopy);
      copy.bones.push(boneCopy);
      copy.boneMap.set(boneCopy.name, boneCopy);
    });

    // 第二遍：設定父子關係
    this.bones.forEach(bone => {
      const boneCopy = boneMapping.get(bone);
      if (bone.parent) {
        const parentCopy = boneMapping.get(bone.parent);
        boneCopy.setParent(parentCopy);
      } else {
        copy.rootBones.push(boneCopy);
      }
    });

    return copy;
  }

  /**
   * 清空骨架
   */
  clear() {
    this.bones = [];
    this.boneMap.clear();
    this.rootBones = [];
    this.autoBoneCounter = 1; // 重置計數器
  }

  /**
   * 更新整個骨架，透過遞迴更新所有骨骼
   */
  update() {
    // 從根骨骼開始更新所有骨骼
    this.rootBones.forEach(bone => {
      this._updateBoneRecursive(bone);
    });
  }

  /**
   * 遞迴更新骨骼及其子骨骼
   * @private
   */
  _updateBoneRecursive(bone) {
    // 強制更新骨骼的變換
    bone.getGlobalTransform();

    // 遞迴更新所有子骨骼
    bone.children.forEach(child => {
      this._updateBoneRecursive(child);
    });
  }
}

/**
 * 頂點群組類
 */
export class VertexGroup {
  constructor(name, bone = null) {
    if (!name || typeof name !== 'string') {
      throw new Error('VertexGroup name must be a non-empty string');
    }
    this.name = name;
    this.bone = bone; // 關聯的骨骼
  }

  /**
   * 設定關聯的骨骼
   */
  setBone(bone) {
    this.bone = bone;
  }
}

/**
 * 計算點到線段的最短距離
 * @param {number} px - 點的 x 座標
 * @param {number} py - 點的 y 座標
 * @param {number} x1 - 線段起點 x
 * @param {number} y1 - 線段起點 y
 * @param {number} x2 - 線段終點 x
 * @param {number} y2 - 線段終點 y
 * @returns {number} 最短距離
 */
function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  if (lenSq === 0) {
    // 線段長度為 0，返回點到點的距離
    return Math.sqrt(A * A + B * B);
  }

  let param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    // 最近點在線段起點
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    // 最近點在線段終點
    xx = x2;
    yy = y2;
  } else {
    // 最近點在線段上
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 計算兩點之間的距離
 * @param {number} x1 
 * @param {number} y1 
 * @param {number} x2 
 * @param {number} y2 
 * @returns {number}
 */
function distance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 檢測滑鼠點擊最近的骨骼
 * @param {Skeleton} skeleton - 骨架實例
 * @param {number} clickX - 點擊的 x 座標
 * @param {number} clickY - 點擊的 y 座標
 * @param {number} headTailRadius - head/tail 檢測半徑，預設 8 像素
 * @param {number} maxDistance - 最大檢測距離，預設 50 像素
 * @returns {Object|null} 回傳 { bone, type, distance } 或 null
 *   - bone: 最近的骨骼實例
 *   - type: 'head', 'tail', 或 'body'
 *   - distance: 到點擊點的距離
 */
export function getClosestBoneAtClick(skeleton, clickX, clickY, isCreatMode = true, headTailRadius = 0.05, maxDistance = 0.05) {
  let closestResult = null;
  let minDistance = maxDistance;

  if (isCreatMode == false) {
    //console.log(" getClosestBoneAtClick in animation mode ");
  }

  skeleton.forEachBone(bone => {
    //if isCreatMode, use getGlobalTransform, else use getPoseTransform
    const transform = isCreatMode ? bone.getGlobalTransform() : bone.getGlobalPoseTransform();
    //const transform = bone.getGlobalTransform();
    if (!transform || !transform.head || !transform.tail) return;
    const head = transform.head;
    const tail = transform.tail;
    // record mouse click offset to bone head
    bone.offsetX = clickX - head.x;
    bone.offsetY = clickY - head.y;
    // 檢測 head
    const headDist = distance(clickX, clickY, head.x, head.y);
    if (headDist <= headTailRadius && headDist < minDistance) {
      // 如果是連接的骨骼的 head，自動轉向 parent 的 tail
      if (bone.isConnected && bone.parent) {
        const parentTail = bone.parent.getGlobalTail();
        const parentTailDist = distance(clickX, clickY, parentTail.x, parentTail.y);
        minDistance = parentTailDist;
        closestResult = {
          bone: bone.parent,
          type: 'tail',
          distance: parentTailDist
        };
      } else {
        minDistance = headDist;
        closestResult = {
          bone: bone,
          type: 'head',
          distance: headDist
        };
      }
    }

    // 檢測 tail
    const tailDist = distance(clickX, clickY, tail.x, tail.y);
    // console.log(" tailDist : ", tailDist, headTailRadius);
    if (tailDist <= headTailRadius && tailDist < minDistance) {
      minDistance = tailDist;
      closestResult = {
        bone: bone,
        type: 'tail',
        distance: tailDist
      };
    }

    // 檢測軀幹（只有在沒有點擊到 head/tail 時才檢查）
    if (!closestResult || closestResult.type === 'middle') {
      const bodyDist = distanceToLineSegment(clickX, clickY, head.x, head.y, tail.x, tail.y);
      if (bodyDist < minDistance) {
        minDistance = bodyDist;
        closestResult = {
          bone: bone,
          type: 'middle',
          distance: bodyDist,
        };

      }
    }

  });

  return closestResult;
}

/**
 * 進階版本：回傳所有在指定距離內的骨骼，按距離排序
 * @param {Skeleton} skeleton - 骼架實例
 * @param {number} clickX - 點擊的 x 座標
 * @param {number} clickY - 點擊的 y 座標
 * @param {number} headTailRadius - head/tail 檢測半徑
 * @param {number} maxDistance - 最大檢測距離
 * @returns {Array} 回傳排序後的結果陣列
 */
export function getAllBonesAtClick(skeleton, clickX, clickY, headTailRadius = 8, maxDistance = 5) {
  const results = [];

  skeleton.forEachBone(bone => {
    const transform = bone.getGlobalTransform();
    const head = transform.head;
    const tail = transform.tail;

    // 檢測 head
    const headDist = distance(clickX, clickY, head.x, head.y);
    console.log(" headDist : ", headDist, headTailRadius);
    if (headDist <= headTailRadius) {
      results.push({
        bone: bone,
        type: 'head',
        distance: headDist
      });
    }

    // 檢測 tail
    const tailDist = distance(clickX, clickY, tail.x, tail.y);
    console.log(" tailDist : ", tailDist, headTailRadius);
    if (tailDist <= headTailRadius) {
      results.push({
        bone: bone,
        type: 'tail',
        distance: tailDist
      });
    }

    // 檢測軀幹
    const bodyDist = distanceToLineSegment(clickX, clickY, head.x, head.y, tail.x, tail.y);
    if (bodyDist <= maxDistance) {
      results.push({
        bone: bone,
        type: 'body',
        distance: bodyDist
      });
    }
  });

  // 按距離排序，優先選擇 head/tail
  return results.sort((a, b) => {
    // 如果距離相近，優先選擇 head/tail
    if (Math.abs(a.distance - b.distance) < 1) {
      const priorityA = a.type === 'body' ? 0 : 1;
      const priorityB = b.type === 'body' ? 0 : 1;
      return priorityB - priorityA;
    }
    return a.distance - b.distance;
  });
}


/**
 * 2D 網格類
 */
export class Mesh2D {
  constructor(name = "") {
    this.name = name;
    this.visible = true;
    this.vertices = [];
    this.groups = {}; // { groupName: VertexGroup }
    this.layers = []; // 圖層系統
    this.indices = []; // 三角形索引

    // WebGL 相關
    this.vbo = null; // 頂點緩衝
    this.ebo = null; // 三角形元素緩衝
    this.eboLines = null; // 線條元素緩衝
  }

  /**
   * 添加頂點
   */
  addVertex(x, y, layerName = null) {
    const vertex = new Vertex(x, y);
    this.vertices.push(vertex);

    if (layerName) {
      const layer = this.getLayer(layerName);
      if (layer) {
        layer.addVertex(vertex);
      }
    }

    return vertex;
  }

  /**
   * 移除頂點
   */
  removeVertex(vertex) {
    const index = this.vertices.indexOf(vertex);
    if (index >= 0) {
      this.vertices.splice(index, 1);
      // 從所有圖層中移除
      this.layers.forEach(layer => layer.removeVertex(vertex));
      // 更新索引（移除包含此頂點的三角形）
      this._updateIndicesAfterVertexRemoval(index);
    }
  }

  /**
   * 更新頂點移除後的索引
   */
  _updateIndicesAfterVertexRemoval(removedIndex) {
    // 移除包含此頂點的所有三角形
    this.indices = this.indices.filter(triangleIndices =>
      !triangleIndices.includes(removedIndex)
    );

    // 更新其他索引（減少大於移除索引的值）
    this.indices = this.indices.map(triangleIndices =>
      triangleIndices.map(index => index > removedIndex ? index - 1 : index)
    );
  }

  /**
   * 添加頂點群組
   */
  addGroup(name, bone = null) {
    this.groups[name] = new VertexGroup(name, bone);
    return this.groups[name];
  }

  /**
   * 取得頂點群組
   */
  getGroup(name) {
    return this.groups[name];
  }

  /**
   * 移除頂點群組
   */
  removeGroup(name) {
    if (this.groups[name]) {
      // 從所有頂點中移除此群組的權重
      this.vertices.forEach(vertex => vertex.removeWeight(name));
      delete this.groups[name];
    }
  }

  /**
   * 添加圖層
   */
  addLayer(name) {
    if (!this.getLayer(name)) {
      const layer = new Layer(name);
      this.layers.push(layer);
      return layer;
    }
    return null;
  }

  /**
   * 取得圖層
   */
  getLayer(name) {
    return this.layers.find(layer => layer.name === name);
  }

  /**
   * 移除圖層
   */
  removeLayer(name) {
    const index = this.layers.findIndex(layer => layer.name === name);
    if (index >= 0) {
      this.layers.splice(index, 1);
    }
  }

  /**
   * 添加三角形
   */
  addTriangle(v1Index, v2Index, v3Index) {
    if (v1Index < this.vertices.length &&
      v2Index < this.vertices.length &&
      v3Index < this.vertices.length) {
      this.indices.push([v1Index, v2Index, v3Index]);
    }
  }

  /**
   * 取得頂點的變形後位置（基於骨骼動畫）
   */
  getDeformedVertexPosition(vertexIndex) {
    const vertex = this.vertices[vertexIndex];
    if (!vertex) return null;

    let deformedX = 0;
    let deformedY = 0;
    let totalWeight = 0;

    // 根據權重計算變形
    for (const groupName in vertex.groups) {
      const weight = vertex.groups[groupName];
      const group = this.groups[groupName];

      if (group && group.bone && weight > 0) {
        const boneTransform = group.bone.getGlobalTransform();
        // 這裡可以加入更複雜的變形邏輯
        deformedX += (vertex.x) * weight;
        deformedY += (vertex.y) * weight;
        totalWeight += weight;
      }
    }

    // 如果沒有權重，返回原始位置
    if (totalWeight === 0) {
      return { x: vertex.x, y: vertex.y };
    }

    return {
      x: deformedX / totalWeight,
      y: deformedY / totalWeight
    };
  }

  /**
   * 複製網格
   */
  clone(namePrefix = 'Copy_') {
    const copy = new Mesh2D(namePrefix + this.name);
    copy.visible = this.visible;

    // 複製頂點
    this.vertices.forEach(vertex => {
      copy.vertices.push(vertex.clone());
    });

    // 複製群組
    for (const groupName in this.groups) {
      const group = this.groups[groupName];
      copy.addGroup(group.name, group.bone);
    }

    // 複製圖層
    this.layers.forEach(layer => {
      const newLayer = copy.addLayer(layer.name);
      if (newLayer) {
        newLayer.visible = layer.visible;
        newLayer.locked = layer.locked;
      }
    });

    // 複製索引
    copy.indices = this.indices.map(triangle => [...triangle]);

    return copy;
  }

  /**
   * 清空網格
   */
  clear() {
    this.vertices = [];
    this.groups = {};
    this.layers = [];
    this.indices = [];
  }
}



/**
 * 2D 項目類 - 管理整個專案
 */
export class Project2D {
  constructor(name = "Untitled Project") {
    this.name = name;
    this.meshes = [];
    this.skeletons = [];
    this.meshMap = new Map(); // 快速查找
    this.skeletonMap = new Map(); // 快速查找
  }

  /**
   * 添加網格
   */
  addMesh(name) {
    if (this.meshMap.has(name)) {
      throw new Error(`Mesh with name "${name}" already exists`);
    }

    const mesh = new Mesh2D(name);
    this.meshes.push(mesh);
    this.meshMap.set(name, mesh);
    return mesh;
  }

  /**
   * 添加骨架
   */
  addSkeleton(name) {
    if (this.skeletonMap.has(name)) {
      throw new Error(`Skeleton with name "${name}" already exists`);
    }

    const skeleton = new Skeleton(name);
    this.skeletons.push(skeleton);
    this.skeletonMap.set(name, skeleton);
    return skeleton;
  }

  /**
   * 取得網格
   */
  getMesh(name) {
    return this.meshMap.get(name);
  }

  /**
   * 取得骨架
   */
  getSkeleton(name) {
    return this.skeletonMap.get(name);
  }

  /**
   * 移除網格
   */
  removeMesh(name) {
    const mesh = this.getMesh(name);
    if (!mesh) return false;

    const index = this.meshes.indexOf(mesh);
    if (index >= 0) this.meshes.splice(index, 1);
    this.meshMap.delete(name);

    return true;
  }

  /**
   * 移除骨架
   */
  removeSkeleton(name) {
    const skeleton = this.getSkeleton(name);
    if (!skeleton) return false;

    const index = this.skeletons.indexOf(skeleton);
    if (index >= 0) this.skeletons.splice(index, 1);
    this.skeletonMap.delete(name);

    return true;
  }

  /**
   * 綁定網格到骨架
   */
  bindMeshToSkeleton(meshName, skeletonName) {
    const mesh = this.getMesh(meshName);
    const skeleton = this.getSkeleton(skeletonName);

    if (!mesh || !skeleton) return false;

    // 為骨架中的每個骨骼創建對應的頂點群組
    skeleton.forEachBone(bone => {
      if (!mesh.getGroup(bone.name)) {
        mesh.addGroup(bone.name, bone);
      }
    });

    return true;
  }

  /**
   * 驗證專案
   */
  validate() {
    const errors = [];

    this.skeletons.forEach(skeleton => {
      const skeletonErrors = skeleton.validate();
      errors.push(...skeletonErrors.map(err => `Skeleton "${skeleton.name}": ${err}`));
    });

    return errors;
  }

  /**
   * 匯出專案為 JSON
   */
  toJSON() {
    return {
      name: this.name,
      meshes: this.meshes.map(mesh => ({
        name: mesh.name,
        visible: mesh.visible,
        vertices: mesh.vertices.map(v => ({
          x: v.x,
          y: v.y,
          groups: v.groups
        })),
        groups: Object.entries(mesh.groups).map(([name, group]) => ({
          name,
          boneName: group.bone ? group.bone.name : null
        })),
        layers: mesh.layers.map(layer => ({
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
          vertexIndices: layer.vertices.map(v => mesh.vertices.indexOf(v))
        })),
        indices: mesh.indices
      })),
      skeletons: this.skeletons.map(skeleton => ({
        name: skeleton.name,
        bones: skeleton.bones.map(bone => ({
          name: bone.name,
          localHead: bone.localHead,
          length: bone.length,
          rotation: bone.rotation,
          parentName: bone.parent ? bone.parent.name : null,
          blenderMode: bone.blenderMode,
          localRotation: bone.localRotation,
          globalRotation: bone.globalRotation,
          globalHead: bone.globalHead
        }))
      }))
    };
  }

  /**
   * 從 JSON 載入專案
   */
  static fromJSON(jsonData) {
    const project = new Project2D(jsonData.name);

    // 載入骨架
    jsonData.skeletons.forEach(skeletonData => {
      const skeleton = project.addSkeleton(skeletonData.name);
      const boneMap = new Map();

      // 第一遍：創建所有骨骼
      skeletonData.bones.forEach(boneData => {
        const bone = new Bone(
          boneData.name,
          boneData.localHead.x,
          boneData.localHead.y,
          boneData.length,
          boneData.rotation,
          null,
          boneData.blenderMode
        );
        skeleton.bones.push(bone);
        skeleton.boneMap.set(bone.name, bone);
        boneMap.set(boneData.name, bone);
      });

      // 第二遍：設定父子關係
      skeletonData.bones.forEach(boneData => {
        const bone = boneMap.get(boneData.name);
        if (boneData.parentName) {
          const parent = boneMap.get(boneData.parentName);
          bone.setParent(parent);
        } else {
          skeleton.rootBones.push(bone);
        }
      });
    });

    // 載入網格
    jsonData.meshes.forEach(meshData => {
      const mesh = project.addMesh(meshData.name);
      mesh.visible = meshData.visible;

      // 載入頂點
      meshData.vertices.forEach(vertexData => {
        const vertex = new Vertex(vertexData.x, vertexData.y);
        vertex.groups = vertexData.groups;
        mesh.vertices.push(vertex);
      });

      // 載入群組
      meshData.groups.forEach(groupData => {
        const bone = groupData.boneName ?
          project.skeletons.find(s => s.getBone(groupData.boneName))?.getBone(groupData.boneName) :
          null;
        mesh.addGroup(groupData.name, bone);
      });

      // 載入圖層
      if (meshData.layers) {
        meshData.layers.forEach(layerData => {
          const layer = mesh.addLayer(layerData.name);
          if (layer) {
            layer.visible = layerData.visible;
            layer.locked = layerData.locked;
            // 添加頂點到圖層
            layerData.vertexIndices.forEach(index => {
              if (index < mesh.vertices.length) {
                layer.addVertex(mesh.vertices[index]);
              }
            });
          }
        });
      }

      // 載入索引
      mesh.indices = meshData.indices || [];
    });

    return project;
  }

  /**
   * 清空專案
   */
  clear() {
    this.meshes = [];
    this.skeletons = [];
    this.meshMap.clear();
    this.skeletonMap.clear();
  }
}


//slot is spine2d's concept, if export to spine2d json, need to use slot
export class Slot {
  constructor({
    name,
    bone,
    attachments = {},
    currentAttachmentName = null,
    color = { r: 1, g: 1, b: 1, a: 1 },
    blendMode = 'normal',
    visible = true,
    zIndex = 0,
  }) {
    if (!name || typeof name !== 'string') {
      throw new Error('Slot name must be a non-empty string');
    }
    if (!(bone instanceof Bone)) {
      throw new Error('Slot must attach to a valid Bone');
    }

    this.id = `${name}_${globalSlotId++}`;
    this.name = name;
    this.bone = bone;
    this.attachments = attachments; // { name: Layer or Mesh or Image }
    this.currentAttachmentName = currentAttachmentName;
    this.color = color;
    this.blendMode = blendMode;
    this.visible = visible;
    this.zIndex = zIndex;

    bone.slot = this;
  }

  addAttachment(name, attachment) {
    this.attachments[name] = attachment;
  }

  removeAttachment(name) {
    delete this.attachments[name];
  }

  setAttachment(name) {
    if (!this.attachments[name]) {
      console.warn(`Attachment "${name}" not found in slot "${this.name}"`);
      return;
    }
    this.currentAttachmentName = name;
  }

  get currentAttachment() {
    return this.attachments[this.currentAttachmentName] || null;
  }

  getWorldTransform() {
    return this.bone.getGlobalTransform();
  }
}

export function Attachment(layerData, glTexture) {
  return {
    name: layerData.name || 'Unnamed',
    image: layerData.imageData,
    texture: glTexture,          // WebGL texture object
    width: layerData.width,
    height: layerData.height,
    top: layerData.top,
    left: layerData.left,
    bottom: layerData.bottom,
    right: layerData.right,
    vertices: layerData.vertices || [],
    indices: layerData.indices || [],
    poseVertices: layerData.poseVertices || [],
    coords: {
      top: layerData.top,
      left: layerData.left,
      bottom: layerData.bottom,
      right: layerData.right
    },
    visible: layerData.visible ?? true,
    opacity: layerData.opacity ?? 1.0,
  };
}



/**
 * 工具函數
 */
export const Utils = {
  /**
   * 角度轉弧度
   */
  degToRad(degrees) {
    return degrees * Math.PI / 180;
  },

  /**
   * 弧度轉角度
   */
  radToDeg(radians) {
    return radians * 180 / Math.PI;
  },

  /**
   * 向量長度
   */
  vectorLength(x, y) {
    return Math.sqrt(x * x + y * y);
  },

  /**
   * 向量正規化
   */
  normalizeVector(x, y) {
    const length = this.vectorLength(x, y);
    if (length === 0) return { x: 0, y: 0 };
    return { x: x / length, y: y / length };
  },

  /**
   * 兩點距離
   */
  distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /**
   * 線性插值
   */
  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  /**
   * 角度插值（處理環形）
   */
  lerpAngle(a, b, t) {
    const diff = b - a;
    const wrappedDiff = ((diff % (2 * Math.PI)) + (3 * Math.PI)) % (2 * Math.PI) - Math.PI;
    return a + wrappedDiff * t;
  },

  /**
   * 限制值在範圍內
   */
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
};