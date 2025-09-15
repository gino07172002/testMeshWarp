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
export class Bone {
  constructor(name, headX, headY, length = 50, rotation = 0, parent = null, isConnected = true) {
    console.log("Bone constructor got:", name, typeof name);
    if (!name || typeof name !== 'string') {
      throw new Error('Bone name must be a non-empty string');
    }

    this.name = name;
    this.children = []; // Initialize children array
    this.length = Math.max(0, length);
    this.parent = parent;
    this.isConnected = isConnected;

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
    else  {
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

    // 標記需要更新
    this._markDirty();

    // 更新子骨骼位置
    childrenGlobalInfo.forEach(({ bone, headPos, tailPos, rotation }) => {
      if (bone.isConnected) {
        // 如果是連接的子骨骼，需要跟隨父骨骼的尾部
        const parentTail = this.getGlobalTail();
        bone.setGlobalHead(parentTail.x, parentTail.y);
      } else {
        // 如果不是連接的子骨骼，保持其原始全域位置
        bone.setPoseGlobalHead(headPos.x, headPos.y);
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
    // change global rotation and length based on new tail position
    const head = this.getGlobalPoseTransform().head;
    const dx = x - head.x;
    const dy = y - head.y;
    this.poseLength = Math.sqrt(dx * dx + dy * dy); 
    this.globalRotation = Math.atan2(dy, dx);

    if (this.parent) {
      const parentTransform = this.parent.getGlobalPoseTransform();
      this.poseRotation = Math.atan2(dy, dx) - parentTransform.rotation;
      this.poseGlobalRotation = Math.atan2(dy, dx);
    } else {
      this.poseRotation = Math.atan2(dy, dx);
      this.poseGlobalRotation = this.poseRotation;
    }
    this.poseGlobalHead = { ...head }; // keep head same
    
    this._markDirty();

    //if children is connected, move them too
    this.children.forEach(child => {
      if (child.isConnected) {
        //set child's head to this bone's new tail position
        child.setPoseGlobalHead(x, y);
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
      this.localRotation = Math.atan2(dy, dx) - parentTransform.rotation;
      this.globalRotation = Math.atan2(dy, dx);
    } else {
      this.localRotation = Math.atan2(dy, dx);
      this.globalRotation = this.localRotation;
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
      childBone.globalRotation = Math.atan2(tailDy, tailDx);

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

    // 更新所有連接的子骨骼位置和旋轉
    
    childrenOriginalTails.forEach(({ bone: childBone, tail }) => {
      // 設置子骨骼的頭部到當前骨骼的新尾部位置
      childBone.setPoseGlobalHead(x, y);

      // 計算並設置子骨骼的新角度和長度，以保持尾部在原位
      const tailDx = tail.x - x;
      const tailDy = tail.y - y;
      childBone.length = Math.sqrt(tailDx * tailDx + tailDy * tailDy);
      childBone.globalRotation = Math.atan2(tailDy, tailDx);

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
export function getClosestBoneAtClick(skeleton, clickX, clickY,isCreatMode=true, headTailRadius = 0.02, maxDistance = 0.03) {
  let closestResult = null;
  let minDistance = maxDistance;

  if(isCreatMode==false)
  {
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

// 使用範例：
/*
// 假設你有一個 skeleton 實例
const skeleton = new Skeleton("MyArmature");

// 添加一些骨骼
const rootBone = skeleton.addBone("Root", 100, 100, 80, 0);
const childBone = skeleton.addBone("Child", 0, 0, 60, Math.PI/4, rootBone);

// 檢測點擊
function onMouseClick(event) {
  const rect = canvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;
  
  const result = getClosestBoneAtClick(skeleton, clickX, clickY);
  
  if (result) {
    console.log(`點擊到骨骼: ${result.bone.name}`);
    console.log(`點擊部位: ${result.type}`);
    console.log(`距離: ${result.distance.toFixed(2)} 像素`);
    
    // 根據點擊類型執行不同操作
    switch(result.type) {
      case 'head':
        console.log('可以拖拽移動 head 位置');
        break;
      case 'tail':
        console.log('可以拖拽調整長度和角度');
        break;
      case 'body':
        console.log('可以拖拽整個骨骼');
        break;
    }
  } else {
    console.log('沒有點擊到任何骨骼');
  }
}

// 如果你想要更精確的控制，可以使用進階版本
function onMouseClickAdvanced(event) {
  const rect = canvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;
  
  const results = getAllBonesAtClick(skeleton, clickX, clickY);
  
  if (results.length > 0) {
    console.log(`找到 ${results.length} 個可能的目標:`);
    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.bone.name} (${result.type}) - 距離: ${result.distance.toFixed(2)}`);
    });
    
    // 使用最近的結果
    const closest = results[0];
    console.log(`選擇: ${closest.bone.name} 的 ${closest.type}`);
  }
}
*/

/**
 * 圖層類
 */
export class Layer {
  constructor(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Layer name must be a non-empty string');
    }
    this.name = name;
    this.vertices = [];
    this.visible = true;
    this.locked = false;
  }

  addVertex(vertex) {
    if (!this.vertices.includes(vertex)) {
      this.vertices.push(vertex);
    }
  }

  removeVertex(vertex) {
    const index = this.vertices.indexOf(vertex);
    if (index >= 0) {
      this.vertices.splice(index, 1);
    }
  }

  clear() {
    this.vertices = [];
  }
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

/**
 * 動畫關鍵幀類
 */
export class Keyframe {
  constructor(time, value, interpolation = 'linear') {
    this.time = time; // 時間（秒）
    this.value = value; // 值（可以是數字、向量等）
    this.interpolation = interpolation; // 插值類型：'linear', 'bezier', 'step'
    this.inTangent = null; // 貝塞爾曲線入切線
    this.outTangent = null; // 貝塞爾曲線出切線
  }

  /**
   * 設定貝塞爾切線
   */
  setBezierTangents(inTangent, outTangent) {
    this.inTangent = inTangent;
    this.outTangent = outTangent;
  }
}

/**
 * 動畫軌道類
 */
export class AnimationTrack {
  constructor(targetPath, property) {
    this.targetPath = targetPath; // 目標路徑，例如 "skeleton.bone1.rotation"
    this.property = property; // 屬性名稱
    this.keyframes = []; // 關鍵幀數組
  }

  /**
   * 添加關鍵幀
   */
  addKeyframe(time, value, interpolation = 'linear') {
    const keyframe = new Keyframe(time, value, interpolation);

    // 保持關鍵幀按時間排序
    let insertIndex = 0;
    while (insertIndex < this.keyframes.length && this.keyframes[insertIndex].time < time) {
      insertIndex++;
    }

    this.keyframes.splice(insertIndex, 0, keyframe);
    return keyframe;
  }

  /**
   * 移除關鍵幀
   */
  removeKeyframe(time) {
    const index = this.keyframes.findIndex(kf => Math.abs(kf.time - time) < 0.001);
    if (index >= 0) {
      this.keyframes.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 取得指定時間的插值
   */
  evaluate(time) {
    if (this.keyframes.length === 0) return null;
    if (this.keyframes.length === 1) return this.keyframes[0].value;

    // 找到時間範圍
    let leftIndex = -1;
    let rightIndex = -1;

    for (let i = 0; i < this.keyframes.length; i++) {
      if (this.keyframes[i].time <= time) {
        leftIndex = i;
      }
      if (this.keyframes[i].time >= time && rightIndex === -1) {
        rightIndex = i;
        break;
      }
    }

    // 邊界情況
    if (leftIndex === -1) return this.keyframes[0].value;
    if (rightIndex === -1) return this.keyframes[this.keyframes.length - 1].value;
    if (leftIndex === rightIndex) return this.keyframes[leftIndex].value;

    // 插值計算
    const leftKf = this.keyframes[leftIndex];
    const rightKf = this.keyframes[rightIndex];
    const t = (time - leftKf.time) / (rightKf.time - leftKf.time);

    return this._interpolate(leftKf, rightKf, t);
  }

  /**
   * 插值計算
   */
  _interpolate(leftKf, rightKf, t) {
    switch (leftKf.interpolation) {
      case 'step':
        return leftKf.value;

      case 'linear':
        if (typeof leftKf.value === 'number') {
          return leftKf.value + (rightKf.value - leftKf.value) * t;
        } else if (leftKf.value.x !== undefined) {
          // 向量插值
          return {
            x: leftKf.value.x + (rightKf.value.x - leftKf.value.x) * t,
            y: leftKf.value.y + (rightKf.value.y - leftKf.value.y) * t
          };
        }
        break;

      case 'bezier':
        // 簡化的貝塞爾插值（三次貝塞爾）
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;

        if (typeof leftKf.value === 'number') {
          const p0 = leftKf.value;
          const p1 = leftKf.outTangent || leftKf.value;
          const p2 = rightKf.inTangent || rightKf.value;
          const p3 = rightKf.value;

          return mt3 * p0 + 3 * mt2 * t * p1 + 3 * mt * t2 * p2 + t3 * p3;
        }
        break;
    }

    return leftKf.value;
  }

  /**
   * 取得軌道的時間範圍
   */
  getTimeRange() {
    if (this.keyframes.length === 0) return { start: 0, end: 0 };
    return {
      start: this.keyframes[0].time,
      end: this.keyframes[this.keyframes.length - 1].time
    };
  }
}

/**
 * 動畫片段類
 */
export class AnimationClip {
  constructor(name, duration = 1.0) {
    this.name = name;
    this.duration = duration; // 動畫時長（秒）
    this.tracks = []; // 動畫軌道數組
    this.loop = true; // 是否循環播放
  }

  /**
   * 添加軌道
   */
  addTrack(targetPath, property) {
    const track = new AnimationTrack(targetPath, property);
    this.tracks.push(track);
    return track;
  }

  /**
   * 移除軌道
   */
  removeTrack(targetPath, property) {
    const index = this.tracks.findIndex(t =>
      t.targetPath === targetPath && t.property === property
    );
    if (index >= 0) {
      this.tracks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 取得軌道
   */
  getTrack(targetPath, property) {
    return this.tracks.find(t =>
      t.targetPath === targetPath && t.property === property
    );
  }

  /**
   * 評估動畫在指定時間的狀態
   */
  evaluate(time) {
    const result = {};

    this.tracks.forEach(track => {
      const value = track.evaluate(time);
      if (value !== null) {
        if (!result[track.targetPath]) {
          result[track.targetPath] = {};
        }
        result[track.targetPath][track.property] = value;
      }
    });

    return result;
  }

  /**
   * 自動計算持續時間
   */
  calculateDuration() {
    let maxTime = 0;
    this.tracks.forEach(track => {
      const range = track.getTimeRange();
      maxTime = Math.max(maxTime, range.end);
    });
    this.duration = maxTime;
  }
}

/**
 * 動畫播放器類
 */
export class AnimationPlayer {
  constructor() {
    this.clips = new Map(); // 動畫片段
    this.currentTime = 0;
    this.isPlaying = false;
    this.playbackSpeed = 1.0;
    this.currentClip = null;
  }

  /**
   * 添加動畫片段
   */
  addClip(clip) {
    this.clips.set(clip.name, clip);
  }

  /**
   * 播放動畫
   */
  play(clipName) {
    const clip = this.clips.get(clipName);
    if (!clip) return false;

    this.currentClip = clip;
    this.isPlaying = true;
    return true;
  }

  /**
   * 停止播放
   */
  stop() {
    this.isPlaying = false;
    this.currentTime = 0;
  }

  /**
   * 暫停播放
   */
  pause() {
    this.isPlaying = false;
  }

  /**
   * 繼續播放
   */
  resume() {
    this.isPlaying = true;
  }

  /**
   * 更新動畫（每幀調用）
   */
  update(deltaTime) {
    if (!this.isPlaying || !this.currentClip) return null;

    this.currentTime += deltaTime * this.playbackSpeed;

    // 處理循環
    if (this.currentTime >= this.currentClip.duration) {
      if (this.currentClip.loop) {
        this.currentTime = this.currentTime % this.currentClip.duration;
      } else {
        this.currentTime = this.currentClip.duration;
        this.isPlaying = false;
      }
    }

    // 評估當前狀態
    return this.currentClip.evaluate(this.currentTime);
  }

  /**
   * 應用動畫狀態到目標對象
   */
  applyToProject(project, animationState) {
    if (!animationState) return;

    for (const targetPath in animationState) {
      const properties = animationState[targetPath];
      const target = this._resolveTargetPath(project, targetPath);

      if (target) {
        for (const property in properties) {
          if (target[property] !== undefined) {
            target[property] = properties[property];

            // 如果是骨骼，標記為需要更新
            if (target instanceof Bone) {
              target._markDirty();
            }
          }
        }
      }
    }
  }

  /**
   * 解析目標路徑
   */
  _resolveTargetPath(project, path) {
    const parts = path.split('.');
    let current = project;

    for (const part of parts) {
      if (current.getSkeleton && current.getSkeleton(part)) {
        current = current.getSkeleton(part);
      } else if (current.getMesh && current.getMesh(part)) {
        current = current.getMesh(part);
      } else if (current.getBone && current.getBone(part)) {
        current = current.getBone(part);
      } else if (current[part] !== undefined) {
        current = current[part];
      } else {
        return null;
      }
    }

    return current;
  }
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