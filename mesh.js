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
  constructor(name, x, y, parent = null) {
    this.name = name;
    this.x = x;
    this.y = y;
    this.length = 50;
    this.rotation = 0;
    this.parent = parent;
    this.children = [];
    if (parent) parent.children.push(this);
  }

  setTransform(x, y, rotation) {
    this.x = x;
    this.y = y;
    this.rotation = rotation;
  }

  getGlobalTransform() {
    if (!this.parent) return { x: this.x, y: this.y, rotation: this.rotation };
    const parent = this.parent.getGlobalTransform();
    const angle = parent.rotation;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const gx = parent.x + this.x * cos - this.y * sin;
    const gy = parent.y + this.x * sin + this.y * cos;
    return {
      x: gx,
      y: gy,
      rotation: angle + this.rotation
    };
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