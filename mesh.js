// skeleton-editor.js

export class Vertex {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.groups = {}; // { groupName: weight }
  }

  setWeight(groupName, weight) {
    this.groups[groupName] = weight;
  }

  removeWeight(groupName) {
    delete this.groups[groupName];
  }
}

export class Bone {
  constructor(name, headX, headY, length = 50, rotation = 0, parent = null, blenderMode = true) {
    this.name = name;

    // 本地 head 偏移（對於父 tail 的偏移）
    this.localHead = { x: headX, y: headY };
    this.length = length;
    this.rotation = rotation; // 本地旋轉（弧度）
    this.parent = parent;
    this.children = [];
    this.blenderMode = blenderMode; // true = head 跟隨父 tail

    if (parent) parent.children.push(this);
  }

  // 本地 tail 位置
  getTailLocal() {
    return {
      x: this.localHead.x + this.length * Math.cos(this.rotation),
      y: this.localHead.y + this.length * Math.sin(this.rotation)
    };
  }

  // --- 修改屬性並保持聯動 ---
  setLength(newLength) {
    this.length = newLength;
  }

  setRotation(newRotation) {
    this.rotation = newRotation;
  }

  // 設本地 head 偏移
  setLocalHeadOffset(x, y) {
    this.localHead.x = x;
    this.localHead.y = y;
  }

  // 設本地 tail，並更新 length 與 rotation
  setTailLocal(x, y) {
    const dx = x - this.localHead.x;
    const dy = y - this.localHead.y;
    this.length = Math.sqrt(dx * dx + dy * dy);
    this.rotation = Math.atan2(dy, dx);
  }

  // 設全局 head（會轉回本地座標）
  setGlobalHead(x, y) {
    if (!this.parent) {
      this.localHead.x = x;
      this.localHead.y = y;
      return;
    }
    const parentGlobal = this.parent.getGlobalTransform();
    const dx = x - parentGlobal.tail.x;
    const dy = y - parentGlobal.tail.y;
    const cos = Math.cos(-parentGlobal.rotation);
    const sin = Math.sin(-parentGlobal.rotation);
    this.localHead.x = dx * cos - dy * sin;
    this.localHead.y = dx * sin + dy * cos;
  }

  // 設全局 tail（會自動更新 rotation 與 length）
  setGlobalTail(x, y) {
    const globalHead = this.getGlobalTransform().head;
    const dx = x - globalHead.x;
    const dy = y - globalHead.y;
    this.length = Math.sqrt(dx * dx + dy * dy);
    const parentRotation = this.parent ? this.parent.getGlobalTransform().rotation : 0;
    this.rotation = Math.atan2(dy, dx) - parentRotation;
  }

  // 計算全局變換
  getGlobalTransform() {
    if (!this.parent) {
      const head = { x: this.localHead.x, y: this.localHead.y };
      const tail = {
        x: head.x + this.length * Math.cos(this.rotation),
        y: head.y + this.length * Math.sin(this.rotation)
      };
      return { head, tail, rotation: this.rotation };
    }

    const parentGlobal = this.parent.getGlobalTransform();
    let gx, gy;
    if (this.blenderMode) {
      // head 跟隨父 tail + 本地偏移
      const cos = Math.cos(parentGlobal.rotation);
      const sin = Math.sin(parentGlobal.rotation);
      gx = parentGlobal.tail.x + this.localHead.x * cos - this.localHead.y * sin;
      gy = parentGlobal.tail.y + this.localHead.x * sin + this.localHead.y * cos;
    } else {
      // 自由模式：本地 head 相對於父 head
      const cos = Math.cos(parentGlobal.rotation);
      const sin = Math.sin(parentGlobal.rotation);
      gx = parentGlobal.head.x + this.localHead.x * cos - this.localHead.y * sin;
      gy = parentGlobal.head.y + this.localHead.x * sin + this.localHead.y * cos;
    }

    const totalRotation = parentGlobal.rotation + this.rotation;
    const tailX = gx + this.length * Math.cos(totalRotation);
    const tailY = gy + this.length * Math.sin(totalRotation);

    return {
      head: { x: gx, y: gy },
      tail: { x: tailX, y: tailY },
      rotation: totalRotation
    };
  }

  // 複製骨架（可選是否複製子骨骼）
  clone(deep = false) {
    const copy = new Bone(this.name, this.localHead.x, this.localHead.y, this.length, this.rotation, null, this.blenderMode);
    if (deep) {
      for (const child of this.children) {
        const childCopy = child.clone(true);
        childCopy.parent = copy;
        copy.children.push(childCopy);
      }
    }
    return copy;
  }
}



export class VertexGroup {
  constructor(name, bone = null) {
    this.name = name;
    this.bone = bone; // Reference to a Bone
  }
}


export class Mesh2D {
  constructor(name = "") {
    this.name = name;
    this.visible = true;
    this.vertices = [];
    this.groups = {};

    this.vbo = null; // WebGL VBO for vertex positions
    this.ebo = null; // WebGL EBO for triangle indices
    this.eboLines = null;              // 元素緩衝區（線條）
    this.indices = []; // Array to store triangle indices
  }

  addVertex(x, y, layerName = null) {
    const v = new Vertex(x, y);
    this.vertices.push(v);
    if (layerName) {
      const layer = this.layers.find(l => l.name === layerName);
      if (layer) layer.addVertex(v);
    }
    return v;
  }

  removeVertex(vertex) {
    const i = this.vertices.indexOf(vertex);
    if (i >= 0) this.vertices.splice(i, 1);
    this.layers.forEach(layer => layer.removeVertex(vertex));
  }

  addGroup(name, bone = null) {
    this.groups[name] = new VertexGroup(name, bone);
  }

  getGroup(name) {
    return this.groups[name];
  }


}

export class Skeleton {
  constructor(name = "") {
    this.name = name;
    this.bones = [];
  }

  addBone(name, x, y, parent = null) {
    const bone = new Bone(name, x, y, parent);
    this.bones.push(bone);
    return bone;
  }

  getBone(name) {
    return this.bones.find(b => b.name === name);
  }
}

export class Project2D {
  constructor() {
    this.meshes = [];
    this.skeletons = [];
  }

  addMesh(name) {
    const mesh = new Mesh2D(name);
    this.meshes.push(mesh);
    return mesh;
  }

  addSkeleton(name) {
    const skeleton = new Skeleton(name);
    this.skeletons.push(skeleton);
    return skeleton;
  }

  getMesh(name) {
    return this.meshes.find(m => m.name === name);
  }

  getSkeleton(name) {
    return this.skeletons.find(s => s.name === name);
  }
}