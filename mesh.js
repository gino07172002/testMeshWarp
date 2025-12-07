// mesh.js
//temporarily put here
const { defineStore } = Pinia;// mesh.js

// ---------------------------------------------------------
// 📦 1. 外部依賴與全域工具
// ---------------------------------------------------------
export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0 }),
  actions: { increment() { this.count++; }, },
});

class IdGenerator {
  static counters = { bone: 0, slot: 0, mesh: 0 };
  static next(prefix = 'obj') {
    if (!this.counters[prefix]) this.counters[prefix] = 0;
    return `${prefix}_${this.counters[prefix]++}_${Date.now().toString(36).slice(-4)}`;
  }
}

export class MathUtils {
  static degToRad(deg) { return deg * Math.PI / 180; }
  static radToDeg(rad) { return rad * 180 / Math.PI; }
  
  static distance(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); }

  static distanceToLineSegment(px, py, x1, y1, x2, y2) {
    const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
    const lenSq = C * C + D * D;
    if (lenSq === 0) return Math.sqrt(A * A + B * B);
    let param = (A * C + B * D) / lenSq;
    param = Math.max(0, Math.min(1, param)); 
    const xx = x1 + param * C;
    const yy = y1 + param * D;
    return Math.sqrt((px - xx) ** 2 + (py - yy) ** 2);
  }

  static rotate(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  }

  static localToGlobal(localX, localY, parentHead, parentRotation) {
    const rotated = this.rotate(localX, localY, parentRotation);
    return { x: parentHead.x + rotated.x, y: parentHead.y + rotated.y };
  }

  static globalToLocal(globalX, globalY, parentHead, parentRotation) {
    const dx = globalX - parentHead.x;
    const dy = globalY - parentHead.y;
    return this.rotate(dx, dy, -parentRotation);
  }
}
export const Utils = MathUtils;

// ---------------------------------------------------------
// 📦 2. Spine Binary Writer
// ---------------------------------------------------------
class SpineBinaryWriter {
    constructor() { this.buffer = []; }
    writeByte(val) { this.buffer.push(val & 0xFF); }
    writeBoolean(val) { this.buffer.push(val ? 1 : 0); }
    writeShort(val) { this.buffer.push((val >> 8) & 0xFF); this.buffer.push(val & 0xFF); }
    writeInt(val) { this.buffer.push((val >> 24) & 0xFF); this.buffer.push((val >> 16) & 0xFF); this.buffer.push((val >> 8) & 0xFF); this.buffer.push(val & 0xFF); }
    writeVarInt(value, optimizePositive) {
        if (!optimizePositive) value = (value << 1) ^ (value >> 31);
        value >>>= 0; 
        while (value & ~0x7F) { this.buffer.push((value & 0x7F) | 0x80); value >>>= 7; }
        this.buffer.push(value);
    }
    writeFloat(val) {
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val, false); 
        const bytes = new Uint8Array(buf);
        this.buffer.push(bytes[0], bytes[1], bytes[2], bytes[3]); 
    }
    writeColor(hexColor) {
        const r = parseInt(hexColor.substring(0, 2), 16);
        const g = parseInt(hexColor.substring(2, 4), 16);
        const b = parseInt(hexColor.substring(4, 6), 16);
        const a = parseInt(hexColor.substring(6, 8), 16);
        this.buffer.push(r, g, b, a);
    }
    writeString(value) {
        if (!value) { this.writeVarInt(0, true); return; }
        if (value.length === 0) { this.writeVarInt(1, true); return; }
        const encoder = new TextEncoder();
        const bytes = encoder.encode(value);
        this.writeVarInt(bytes.length + 1, true);
        for (let b of bytes) this.buffer.push(b);
    }
    getUint8Array() { return new Uint8Array(this.buffer); }
}

// ---------------------------------------------------------
// 📦 3. Vertex, Attachment, Slot
// ---------------------------------------------------------
export class Vertex {
  constructor(x, y) { this.x = x; this.y = y; this.groups = {}; this.poseX = x; this.poseY = y; }
  setWeight(groupName, weight) { if (weight <= 0) delete this.groups[groupName]; else this.groups[groupName] = Math.max(0, Math.min(1, weight)); }
  getWeight(groupName) { return this.groups[groupName] || 0; }
  removeWeight(groupName) { delete this.groups[groupName]; }
  resetPose() { this.poseX = this.x; this.poseY = this.y; }
  clone() { const v = new Vertex(this.x, this.y); v.groups = { ...this.groups }; return v; }
}

export class Attachment {
  constructor(data = {}) {
    this.name = data.name || 'Unnamed';
    this.type = data.type || 'region';
    this.visible = data.visible ?? true;
    this.image = data.image || data.imageData || null;
    this.texture = data.texture || null;
    this.width = data.width || 0;
    this.height = data.height || 0;
    this.coords = { top: data.top || 0, left: data.left || 0, bottom: data.bottom || 0, right: data.right || 0 };
    this.vertices = data.vertices || [];
    this.indices = data.indices || [];
    this.poseVertices = data.poseVertices || [];
    this.opacity = data.opacity ?? 1.0;
    this.refId = data.refId ?? null;
  }
}

export class Slot {
  constructor({ name, bone, attachments = {}, currentAttachmentName = null, color = { r: 1, g: 1, b: 1, a: 1 }, blendMode = 'normal', visible = true }) {
    if (!name) throw new Error('Slot name required');
    if (!bone) throw new Error('Slot must attach to a Bone');
    this.id = IdGenerator.next('slot');
    this.name = name;
    this.bone = bone;
    this.attachments = attachments; 
    this.currentAttachmentName = currentAttachmentName;
    this.color = color;
    this.blendMode = blendMode;
    this.visible = visible;
    if (!bone.slots) bone.slots = [];
    bone.slots.push(this);
  }
  addAttachment(name, attachment) { this.attachments[name] = attachment instanceof Attachment ? attachment : new Attachment(attachment); }
  get currentAttachment() { return this.attachments[this.currentAttachmentName] || null; }
}

// ---------------------------------------------------------
// 📦 4. 骨骼 (Bone)
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
    this.slots = []; 

    // Setup Pose
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
    // Pose
    this.poseHead = { ...this.localHead };
    this.poseRotation = this.localRotation;
    this.poseLength = this.length;
    this.poseGlobalHead = { ...this.globalHead };
    this.poseGlobalRotation = this.globalRotation;
    this.poseGlobalLength = this.length;
    this._globalTransformCache = null;
    this._isDirty = true;

    if (parent) { parent.children.push(this); parent._markDirty(); }
  }

  _markDirty() { this._isDirty = true; this._globalTransformCache = null; this.children.forEach(c => c._markDirty()); }
  getGlobalTransform() { if (!this._isDirty && this._globalTransformCache) return this._globalTransformCache; return this._calculateGlobalTransform(); }
  _calculateGlobalTransform() {
    let head, rotation;
    if (!this.parent) { head = { ...this.localHead }; rotation = this.localRotation; } 
    else {
      const parentT = this.parent.getGlobalTransform();
      head = MathUtils.localToGlobal(this.localHead.x, this.localHead.y, parentT.head, parentT.rotation);
      rotation = parentT.rotation + this.localRotation;
    }
    const tail = { x: head.x + this.length * Math.cos(rotation), y: head.y + this.length * Math.sin(rotation) };
    this.globalHead = head; this.globalRotation = rotation;
    this._globalTransformCache = { head, tail, rotation };
    this._isDirty = false;
    return this._globalTransformCache;
  }
  getGlobalHead() { return this.getGlobalTransform().head; }
  getGlobalTail() { return this.getGlobalTransform().tail; }
  getGlobalPoseTransform() {
    return {
      head: { ...this.poseGlobalHead },
      tail: { x: this.poseGlobalHead.x + this.poseGlobalLength * Math.cos(this.poseGlobalRotation), y: this.poseGlobalHead.y + this.poseGlobalLength * Math.sin(this.poseGlobalRotation) },
      rotation: this.poseGlobalRotation, length: this.poseGlobalLength
    };
  }
  updatePoseGlobalTransform() {
    if (!this.parent) { this.poseGlobalHead = { ...this.poseHead }; this.poseGlobalRotation = this.poseRotation; this.poseGlobalLength = this.poseLength; } 
    else {
      const parentPose = this.parent.getGlobalPoseTransform();
      const global = MathUtils.localToGlobal(this.poseHead.x, this.poseHead.y, parentPose.head, parentPose.rotation);
      this.poseGlobalHead = global; this.poseGlobalRotation = parentPose.rotation + this.poseRotation; this.poseGlobalLength = this.poseLength;
    }
  }
  setGlobalHead(x, y) {
    const oldTail = this.getGlobalTail();
    this.globalHead = { x, y };
    const dx = oldTail.x - x;
    const dy = oldTail.y - y;
    this.length = Math.sqrt(dx*dx + dy*dy);
    this.globalRotation = Math.atan2(dy, dx);
    if(this.parent) {
        const parentT = this.parent.getGlobalTransform();
        this.localHead = MathUtils.globalToLocal(x, y, parentT.head, parentT.rotation);
        this.localRotation = this.globalRotation - parentT.rotation;
    } else {
        this.localHead = { x, y };
        this.localRotation = this.globalRotation;
    }
    this.setPoseGlobalHead(x, y);
    this._markDirty();
    this.children.forEach(child => { if(child.isConnected) child.setGlobalHead(this.getGlobalTail().x, this.getGlobalTail().y); child._markDirty(); }); 
  }
  setGlobalTail(x, y) {
    const head = this.getGlobalHead();
    const dx = x - head.x;
    const dy = y - head.y;
    this.length = Math.sqrt(dx*dx + dy*dy);
    const newGlobalRot = Math.atan2(dy, dx);
    if(this.parent) {
        const parentT = this.parent.getGlobalTransform();
        this.globalRotation = newGlobalRot;
        this.localRotation = newGlobalRot - parentT.rotation;
    } else {
        this.globalRotation = newGlobalRot;
        this.localRotation = newGlobalRot;
    }
    this.setPoseGlobalTail(x, y);
    this._markDirty();
    const newTail = this.getGlobalTail();
    this.children.forEach(child => { if(child.isConnected) child.setGlobalHead(newTail.x, newTail.y); });
  }
  setPoseGlobalHead(x, y) { this.poseGlobalHead = { x, y }; if(this.parent) { const parentPose = this.parent.getGlobalPoseTransform(); this.poseHead = MathUtils.globalToLocal(x, y, parentPose.head, parentPose.rotation); } else { this.poseHead = { x, y }; } this._markDirty(); }
  setPoseGlobalTail(x, y) {
    const head = this.poseGlobalHead;
    const dx = x - head.x;
    const dy = y - head.y;
    const newRot = Math.atan2(dy, dx);
    this.poseGlobalRotation = newRot;
    if(this.parent) {
        const parentPose = this.parent.getGlobalPoseTransform();
        this.poseRotation = newRot - parentPose.rotation;
    } else {
        this.poseRotation = newRot;
    }
    this._markDirty();
    const newTailX = head.x + this.poseLength * Math.cos(newRot);
    const newTailY = head.y + this.poseLength * Math.sin(newRot);
    this.children.forEach(child => { if(child.isConnected) child.setPoseGlobalHead(newTailX, newTailY); });
  }
  setParent(newParent) { if (this.parent) { const idx = this.parent.children.indexOf(this); if (idx >= 0) this.parent.children.splice(idx, 1); } this.parent = newParent; if (newParent) newParent.children.push(this); this._markDirty(); }
  resetPose(recursive = true) { this.poseHead = { ...this.localHead }; this.poseRotation = this.localRotation; this.poseLength = this.length; if (recursive) this.children.forEach(c => c.resetPose(true)); this._markDirty(); }
}

// ---------------------------------------------------------
// 📦 5. 骨架管理 (Skeleton)
// ---------------------------------------------------------
export class Skeleton {
  constructor(name = "NewSkeleton") { this.name = name; this.bones = []; this.boneMap = new Map(); this.rootBones = []; }
  addBone(name, x, y, length = 50, rotation = 0, parent = null, isConnected = true) {
    if (!name) name = `Bone_${this.bones.length + 1}`;
    if (this.boneMap.has(name)) throw new Error(`Bone "${name}" exists`);
    const bone = new Bone(name, x, y, length, rotation, parent, isConnected);
    this.bones.push(bone); this.boneMap.set(name, bone); this.updateRootBones(); return bone;
  }
  getBone(name) { return this.boneMap.get(name); }
  removeBone(name) { /* ... */ }
  updateRootBones() { this.rootBones = this.bones.filter(b => !b.parent); }
  update() { this.rootBones.forEach(root => this._updateRecursive(root)); }
  _updateRecursive(bone) { bone.updatePoseGlobalTransform(); bone.getGlobalTransform(); bone.children.forEach(c => this._updateRecursive(c)); }
  forEachBone(cb) { this.bones.forEach(cb); }

  // === Export Helper ===
  _prepareExportData(scale, layers) {
      // 1. Sort bones by hierarchy (Parent first)
      const bones = [];
      const queue = [...this.rootBones];
      while(queue.length) {
          const b = queue.shift();
          bones.push(b);
          if(b.children) queue.push(...b.children);
      }
      this.bones.forEach(b => { if(!bones.includes(b)) bones.push(b); });

      const slots = [];
      const skins = {}; 
      const processedLayers = new Set();
      
      const createMesh = (layer, attName, pathName) => {
          const rawVerts = layer.vertices.value; 
          const vertexCount = rawVerts.length / 4;
          const uvs = [];
          for(let i=0; i<vertexCount; i++) uvs.push(rawVerts[i*4+2], rawVerts[i*4+3]);
          const triangles = Array.from(layer.indices.value);
          const vertices = [];
          const groups = layer.vertexGroup.value; 
          const influenceMap = new Array(vertexCount).fill(0).map(() => []);
          groups.forEach(g => {
              const boneIdx = bones.findIndex(b => b.name === g.name);
              const boneObj = this.getBone(g.name);
              if(boneIdx === -1 || !boneObj) return;
              g.vertices.forEach(v => {
                  if(v.id < vertexCount && v.weight > 0) influenceMap[v.id].push({ boneIdx, boneObj, weight: v.weight });
              });
          });
          const params = layer.transformParams || { width: 100, height: 100, left: 0, top: 0 };
          for(let i=0; i<vertexCount; i++) {
              const infs = influenceMap[i];
              vertices.push(infs.length); 
              const ndcX = rawVerts[i*4], ndcY = rawVerts[i*4+1];
              const globalX = (ndcX * 0.5 + 0.5) * params.width + params.left;
              const globalY = (1 - (ndcY * 0.5 + 0.5)) * params.height + params.top;
              infs.forEach(inf => {
                  vertices.push(inf.boneIdx);
                  const local = MathUtils.globalToLocal(globalX, globalY, inf.boneObj.getGlobalHead(), inf.boneObj.globalRotation);
                  vertices.push(local.x * scale); 
                  
                  // 🔥 [修正] Y軸翻轉：Mesh 頂點 Y 座標加負號
                  vertices.push(-local.y * scale); 
                  
                  vertices.push(inf.weight);
              });
          }
          return { type: "mesh", name: attName, path: pathName, uvs, triangles, vertices, width: layer.width, height: layer.height, hull: vertexCount };
      };

      // 1. Process existing slots
      this.bones.forEach(bone => {
          if (bone.slots) {
              bone.slots.forEach(slot => {
                  slots.push({ name: slot.name, bone: bone.name, attachment: slot.attachmentKey || null });
                  if (slot.attachments) {
                      Object.keys(slot.attachments).forEach(attKey => {
                          const att = slot.attachments[attKey];
                          const layer = layers[att.refId];
                          if(layer) {
                              processedLayers.add(att.refId);
                              const attName = att.name || attKey;
                              const layerName = layer.name.value || layer.name;

                              if(!skins[slot.name]) skins[slot.name] = {};
                              
                              if (layer.vertexGroup && layer.vertexGroup.value.length > 0) {
                                  skins[slot.name][attName] = createMesh(layer, attName, layerName);
                              } else {
                                  skins[slot.name][attName] = { 
                                      type: "region", 
                                      name: attName, 
                                      path: layerName, 
                                      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, 
                                      width: layer.width, height: layer.height 
                                  };
                              }
                          }
                      });
                  }
              });
          }
      });

      // 2. Auto-process weighted layers
      layers.forEach((layer, index) => {
          if (layer.vertexGroup && layer.vertexGroup.value.length > 0 && !processedLayers.has(index)) {
              const layerName = layer.name.value || layer.name || `Layer_${index}`;
              const slotName = layerName + "_Slot";
              const rootBone = this.rootBones[0] ? this.rootBones[0].name : "root";
              slots.push({ name: slotName, bone: rootBone, attachment: layerName });
              if(!skins[slotName]) skins[slotName] = {};
              skins[slotName][layerName] = createMesh(layer, layerName, layerName);
          }
      });
      return { bones, slots, skins };
  }

  // === Export JSON ===
  exportSpineJson(scale = 1.0, timelineData = null, layers = []) {
    const { bones, slots, skins } = this._prepareExportData(scale, layers);
    const bonesData = bones.map(b => ({
        name: b.name,
        parent: b.parent ? b.parent.name : null,
        length: b.length * scale,
        x: b.parent ? b.localHead.x * scale : b.globalHead.x * scale,
        
        // 🔥 [修正] Y軸翻轉：Bone Y 座標加負號
        y: -(b.parent ? b.localHead.y * scale : b.globalHead.y * scale),
        
        // 🔥 [修正] Y軸翻轉：旋轉角度加負號
        rotation: -MathUtils.radToDeg(b.parent ? b.localRotation : b.globalRotation),
        
        color: "fff200ff"
    }));

    const animations = { "animation": { bones: {}, slots: {} } };
    if (timelineData && timelineData.keyframes) {
        Object.keys(timelineData.keyframes).forEach(boneId => {
            const frames = timelineData.keyframes[boneId];
            const bone = bones.find(b => b.id === boneId);
            if (!bone) return;
            const timeline = { rotate: [], translate: [] };
            
            const setupRotation = MathUtils.radToDeg(bone.parent ? bone.localRotation : bone.globalRotation);
            const setupX = bone.parent ? bone.localHead.x : bone.globalHead.x;
            const setupY = bone.parent ? bone.localHead.y : bone.globalHead.y;

            frames.forEach(f => {
                const t = f.time / 1000.0;
                // 🔥 [修正] 動畫：旋轉加負號
                if(f.rotation !== undefined) timeline.rotate.push({ time: t, value: -(MathUtils.radToDeg(f.rotation) - setupRotation) });
                
                if(f.x!==undefined || f.y!==undefined) {
                    // 🔥 [修正] 動畫：位移 Y 加負號
                    timeline.translate.push({ time: t, x: (f.x||0) - setupX, y: -((f.y||0) - setupY) });
                }
            });
            if(timeline.rotate.length || timeline.translate.length) {
                if(!timeline.rotate.length) delete timeline.rotate;
                if(!timeline.translate.length) delete timeline.translate;
                animations.animation.bones[bone.name] = timeline;
            }
        });
    }

    return { skeleton: { hash: "Gen", spine: "4.1.17", x: 0, y: 0, width: 0, height: 0, images: "./images/", audio: "" }, bones: bonesData, slots: slots, skins: [{ name: "default", attachments: skins }], animations: animations };
  }

  // === Export Binary ===
  exportSpineBinary(scale = 1.0, timelineData = null, layers = []) {
      const writer = new SpineBinaryWriter();
      const { bones, slots, skins } = this._prepareExportData(scale, layers);
      writer.writeString("GeneratedHash"); writer.writeString("4.1.17");      
      writer.writeFloat(0); writer.writeFloat(0); writer.writeFloat(0); writer.writeFloat(0); writer.writeBoolean(false); 

      writer.writeVarInt(bones.length, true);
      bones.forEach((b) => {
          writer.writeString(b.name);
          writer.writeVarInt(b.parent ? bones.indexOf(b.parent) : -1, true); 
          writer.writeFloat(b.length * scale);
          writer.writeFloat(b.parent ? b.localHead.x * scale : b.globalHead.x * scale);
          
          // 🔥 [修正] Y軸翻轉：Bone Y 座標
          writer.writeFloat(-(b.parent ? b.localHead.y * scale : b.globalHead.y * scale));
          
          // 🔥 [修正] Y軸翻轉：旋轉角度
          writer.writeFloat(-MathUtils.radToDeg(b.parent ? b.localRotation : b.globalRotation));
          
          writer.writeFloat(1); writer.writeFloat(1); writer.writeFloat(0); writer.writeFloat(0); 
          writer.writeVarInt(0, true); writer.writeBoolean(false); writer.writeColor("fff200ff"); 
      });

      writer.writeVarInt(slots.length, true);
      slots.forEach(s => {
          writer.writeString(s.name);
          const boneIdx = bones.findIndex(b => b.name === s.bone);
          writer.writeVarInt(boneIdx, true);
          writer.writeColor("ffffffff"); 
          writer.writeVarInt(0, true);   
          writer.writeString(s.attachment); 
      });

      writer.writeVarInt(0, true); writer.writeVarInt(0, true); writer.writeVarInt(0, true); 

      writer.writeVarInt(1, true); writer.writeString("default");
      const slotKeys = Object.keys(skins);
      writer.writeVarInt(slotKeys.length, true); 
      slotKeys.forEach(slotName => {
          const slotIdx = slots.findIndex(s => s.name === slotName);
          writer.writeVarInt(slotIdx, true);
          const attachments = skins[slotName];
          const attNames = Object.keys(attachments);
          writer.writeVarInt(attNames.length, true); 
          attNames.forEach(attName => {
              const att = attachments[attName];
              writer.writeString(attName); 
              if (att.type === 'region') {
                  writer.writeByte(0); writer.writeString(att.path || attName); writer.writeColor("ffffffff"); 
                  writer.writeFloat(att.x); writer.writeFloat(att.y); writer.writeFloat(att.scaleX || 1); writer.writeFloat(att.scaleY || 1);
                  writer.writeFloat(att.rotation); writer.writeFloat(att.width); writer.writeFloat(att.height);
              } else if (att.type === 'mesh') {
                  writer.writeByte(2); writer.writeString(att.path || attName); writer.writeColor("ffffffff"); 
                  const vertexCount = att.uvs.length / 2;
                  writer.writeVarInt(vertexCount, true);
                  for(let i=0; i<att.uvs.length; i++) writer.writeFloat(att.uvs[i]);
                  writer.writeVarInt(att.triangles.length, true); 
                  for(let t of att.triangles) writer.writeShort(t);
                  writer.writeVarInt(att.vertices.length, true); 
                  for(let v of att.vertices) writer.writeFloat(v);
                  writer.writeVarInt(att.hull, true); writer.writeVarInt(0, true); 
                  writer.writeFloat(att.width); writer.writeFloat(att.height);
              }
          });
      });

      writer.writeVarInt(0, true); 

      // Animations
      const animKeys = timelineData && timelineData.keyframes ? Object.keys(timelineData.keyframes) : [];
      if (animKeys.length > 0) {
          writer.writeVarInt(1, true); writer.writeString("animation"); 
          let timelineCount = 0;
          const animBones = {};
          animKeys.forEach(boneId => {
              const frames = timelineData.keyframes[boneId];
              const boneIdx = bones.findIndex(b => b.id === boneId);
              if (boneIdx === -1) return;
              const rotateFrames = frames.filter(f => f.rotation !== undefined);
              const translateFrames = frames.filter(f => f.x !== undefined || f.y !== undefined);
              if(rotateFrames.length) timelineCount++;
              if(translateFrames.length) timelineCount++;
              animBones[boneIdx] = { r: rotateFrames, t: translateFrames };
          });
          
          writer.writeVarInt(timelineCount, true);
          Object.keys(animBones).forEach(bIdx => {
              const data = animBones[bIdx];
              const boneIndex = parseInt(bIdx);
              const bone = bones[boneIndex];
              const setupRotation = MathUtils.radToDeg(bone.parent ? bone.localRotation : bone.globalRotation);
              const setupX = bone.parent ? bone.localHead.x : bone.globalHead.x;
              const setupY = bone.parent ? bone.localHead.y : bone.globalHead.y;

              if(data.r.length > 0) {
                  writer.writeByte(1); writer.writeVarInt(boneIndex, true); 
                  writer.writeVarInt(data.r.length, true); 
                  data.r.forEach(f => {
                      writer.writeFloat(f.time / 30.0);
                      // 🔥 [修正] 動畫：旋轉加負號
                      writer.writeFloat(-(f.rotation * 360 / 6.283185 - setupRotation)); 
                      if(f !== data.r[data.r.length-1]) writer.writeByte(0); 
                  });
              }
              if(data.t.length > 0) {
                  writer.writeByte(2); writer.writeVarInt(boneIndex, true);
                  writer.writeVarInt(data.t.length, true);
                  data.t.forEach(f => {
                      writer.writeFloat(f.time / 30.0);
                      writer.writeFloat((f.x || 0) - setupX); 
                      // 🔥 [修正] 動畫：位移 Y 加負號
                      writer.writeFloat(-((f.y || 0) - setupY)); 
                      if(f !== data.t[data.t.length-1]) writer.writeByte(0); 
                  });
              }
          });
      } else { writer.writeVarInt(0, true); }
      return writer.getUint8Array();
  }
}

// ---------------------------------------------------------
// 📦 6. 互動檢測工具
// ---------------------------------------------------------
export class VertexGroup {
  constructor(name, bone = null) {
    this.name = name;
    this.bone = bone;
    this.vertices = []; 
  }
}

export class Mesh2D {
  constructor(name = "NewMesh") {
    this.name = name;
    this.vertices = []; 
    this.indices = [];
    this.groups = {}; 
    this.image = null;
    this.visible = true;
    this.layers = []; 
    this.vbo = null;
    this.ebo = null;
    this.eboLines = null;
  }
  addVertex(x, y) { const v = new Vertex(x, y); this.vertices.push(v); return v; }
  addGroup(name, bone = null) { if (!this.groups[name]) this.groups[name] = new VertexGroup(name, bone); return this.groups[name]; }
  getGroup(name) { return this.groups[name]; }
  clone(prefix = "Copy_") { const copy = new Mesh2D(prefix + this.name); copy.vertices = this.vertices.map(v => v.clone()); copy.indices = [...this.indices]; return copy; }
}

export class Project2D {
  constructor(name = "Project") { this.name = name; this.meshes = []; this.skeletons = []; }
  addSkeleton(name) { const skel = new Skeleton(name); this.skeletons.push(skel); return skel; }
  addMesh(name) { const mesh = new Mesh2D(name); this.meshes.push(mesh); return mesh; }
}

export function getClosestBoneAtClick(skeleton, clickX, clickY, isCreateMode = true, radius = 10) {
  let best = null; let minDiff = Infinity;
  skeleton.forEachBone(bone => {
    const t = isCreateMode ? bone.getGlobalTransform() : bone.getGlobalPoseTransform();
    const head = t.head; const tail = t.tail;
    const dHead = MathUtils.distance(clickX, clickY, head.x, head.y);
    if (dHead < radius && dHead < minDiff) {
      minDiff = dHead;
      if (bone.isConnected && bone.parent) best = { bone: bone.parent, type: 'tail', distance: dHead };
      else best = { bone: bone, type: 'head', distance: dHead };
      bone.offsetX = clickX - head.x; bone.offsetY = clickY - head.y;
    }
    const dTail = MathUtils.distance(clickX, clickY, tail.x, tail.y);
    if (dTail < radius && dTail < minDiff) {
      minDiff = dTail; best = { bone: bone, type: 'tail', distance: dTail };
      bone.offsetX = clickX - head.x; bone.offsetY = clickY - head.y;
    }
    if (!best) {
        const dBody = MathUtils.distanceToLineSegment(clickX, clickY, head.x, head.y, tail.x, tail.y);
        if (dBody < radius && dBody < minDiff) {
            minDiff = dBody; best = { bone: bone, type: 'middle', distance: dBody };
            bone.offsetX = clickX - head.x; bone.offsetY = clickY - head.y;
        }
    }
  });
  return best;
}