// app.js
const { createApp, onMounted, onUnmounted, ref, reactive, computed, watch, provide } = Vue;
const { createRouter, createWebHashHistory } = VueRouter;
const { createPinia } = Pinia;

// === Imports ===
import {
  globalVars as v,
  convertToNDC,
  selectedLayers,
  currentChosedLayer,
  selectedGroups,
  mousePressed,
  isShiftPressed,
  refreshKey,
  wholeImageWidth,
  wholeImageHeight,
  lastLoadedImageType
} from './globalVars.js';

import {
  boneParents,
  meshSkeleton,
  skeletons,
  lastSelectedBone,
  selectedVertices,
  bonesInstance
} from './useBone.js';

import {
  gl,
  texture,
  program,
  colorProgram,
  skeletonProgram,
  weightPaintProgram,
  skinnedProgram,
  render,
  render2,
  setCurrentJobName,
  renderGridOnly,
  renderMeshSkeleton,
  renderMeshSkeleton2,
  renderWeightPaint,
  layerForTextureWebgl,
  layerToTexture,
  psdRender,
  pngRender,
  makeRenderPass,
  bindGl,
  clearTexture,
  pngLoadTexture,
  renderOutBoundary,
  restoreWebGLResources
} from './useWebGL.js';

import glsInstance from './useWebGL.js';
import { processPSDFile } from './psd.js';
import { Timeline2 } from './timeline2.js';
import { useCounterStore } from './mesh.js'; // 假設這是在 mesh.js 定義的 store

// 引入頁面組件
import { Home } from './Home.js';
import { allEditor } from './allEditor.js';
import { Editor } from './Editor.js';
import { Page } from './page.js';
import { meshEditor } from './meshEditor.js';

// Global Reactive Objects
export const boneIdToIndexMap = reactive({});
export const boneTree = reactive({});

window.testWord = 'Hello';

// === TreeItem 組件定義 (保持 Options API 結構作為子組件是沒問題的) ===
const TreeItem = {
  name: 'TreeItem', // 遞迴組件必須有名稱
  props: ['node', 'expandedNodes', 'selectedItem', 'layers'],
  emits: [
    'toggle-node', 'item-click',
    'slot-visible-change', 'slot-attachment-change',
    'slot-reorder'
  ],
  template: `
    <div class="tree-item">
      <div class="tree-item-header" style="display:flex;align-items:center;">
        <span v-if="hasChildren||hasSlots" style="cursor:pointer;width:16px"
              @click.stop="toggleNode(node.id)">
          {{ isExpanded?'▼':'▶' }}
        </span>
        <span v-else style="display:inline-block;width:16px"/>
        
        <span style="cursor:pointer;margin-left:4px"
              :style="{backgroundColor:
                selectedItem?.type==='bone'&&selectedItem?.id===node.id?'#444':'transparent', color: selectedItem?.type==='bone'&&selectedItem?.id===node.id?'#fff':'inherit'}"
              @click="selectItem({type:'bone',id:node.id, data: node})">
          🦴 {{ node.name || '(未命名骨骼)' }}
        </span>
        
        <button @click.stop="addSlot(0)" title="新增 Slot" style="font-size:10px; margin-left:8px;">➕ Slot</button>
      </div>

      <div v-if="isExpanded" class="tree-item-children" style="padding-left:20px; border-left: 1px dashed #ccc;">
        
        <div v-for="(slot,idx) in node.slots" :key="slot.id"
             style="display:flex;align-items:center;cursor:pointer;padding:2px 0; border-bottom:1px solid #eee;"
             :style="{backgroundColor:
                selectedItem?.type==='slot'&&selectedItem?.id===slot.id?'#e0e0e0':'transparent'}"
             @click="selectItem({type:'slot',id:slot.id, data: slot})">

          <span style="font-size:12px; margin-right:5px;" @click.stop="toggleSlotVisible(slot)"
                :title="slot.visible?'隱藏':'顯示'">
            {{ slot.visible?'👁':'🚫' }}
          </span>

          <span style="font-size:13px;">🎯 {{ slot.name }}</span>

          <span style="font-size:10px; color:#888; margin-left:4px;">
            {{ slot.blendMode === 'normal' ? '' : '['+slot.blendMode+']' }}
          </span>

          <select v-if="slot.attachments && Object.keys(slot.attachments).length"
                  style="margin-left:6px;font-size:11px;max-width:80px;"
                  :value="slot.attachmentKey||''"
                  @change="changeAttachment(slot,$event.target.value)" @click.stop>
            <option value="">(空)</option>
            <option v-for="k in Object.keys(slot.attachments)" :key="k" :value="k">
              {{ k }}
            </option>
          </select>
          
          <button @click.stop="appendAttachment(slot)" title="新增 Attachment" style="font-size:10px; margin-left:2px;">📎+</button>

          <span style="margin-left:auto;display:flex;gap:2px;font-size:12px">
            <button @click.stop="moveSlot(idx,-1)" :disabled="idx===0" title="上移">⬆</button>
            <button @click.stop="moveSlot(idx,1)"  :disabled="idx===node.slots.length-1" title="下移">⬇</button>
            <button @click.stop="deleteSlot(idx)" title="刪除 Slot">🗑</button>
          </span>
        </div>

        <tree-item v-for="c in node.children" :key="c.id"
                   :node="c" :expanded-nodes="expandedNodes"
                   :selected-item="selectedItem" :layers="layers"
                   @toggle-node="$emit('toggle-node',$event)"
                   @item-click="$emit('item-click',$event)"
                   @slot-visible-change="$emit('slot-visible-change',$event)"
                   @slot-attachment-change="$emit('slot-attachment-change',$event)"
                   @slot-reorder="$emit('slot-reorder',$event)"/>
      </div>
    </div>
  `,
  computed: {
    hasChildren() { return this.node.children && this.node.children.length > 0; },
    hasSlots() { return this.node.slots && this.node.slots.length > 0; },
    isExpanded() { return this.expandedNodes.includes(this.node.id); }
  },
  methods: {
    toggleNode(id) { this.$emit('toggle-node', id); },
    selectItem(payload) { this.$emit('item-click', payload); },
    
    toggleSlotVisible(slot) {
      slot.visible = !slot.visible;
      this.$emit('slot-visible-change', { slotId: slot.id, visible: slot.visible });
    },

    changeAttachment(slot, key) {
      const validKey = key === "" ? null : key;
      slot.attachmentKey = validKey;
      this.$emit('slot-attachment-change', {
        slotId: slot.id,
        key: validKey,
        attachment: validKey ? slot.attachments[validKey] : null
      });
    },

    // 新增 Slot
    addSlot(insertBeforeIdx) {
      const name = prompt('新 Slot 名稱：', 'newSlot');
      if (!name) return;

      // 讓使用者選擇初始綁定的圖層
      let items = "";
      if(this.layers && this.layers.length > 0) {
         items = this.layers.map((L, i) => `${i}:${L.name.value}`).join('\n');
      } else {
         items = "無可用圖層";
      }
      
      const pick = prompt(`選擇初始圖片 (Attachment) Index (輸入 -1 跳過):\n${items}`, "0");
      const idx = Number(pick);
      const hasValidLayer = !Number.isNaN(idx) && idx >= 0 && this.layers && this.layers[idx];

      const newSlot = {
        id: `slot_${Date.now()}`,
        name: name,
        boneId: this.node.id,
        visible: true,
        blendMode: 'normal',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachmentKey: hasValidLayer ? 'default' : null,
        attachments: {}
      };

      if (hasValidLayer) {
        newSlot.attachments['default'] = {
          type: 'region',
          name: 'default',
          refId: idx,
          path: this.layers[idx].name.value,
          x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 100, height: 100
        };
      }

      this.node.slots.splice(this.node.slots.length, 0, newSlot); // 加在最後面
      this.reorderDone();
    },

    // 新增 Attachment (Skin)
    appendAttachment(slot) {
      const key = prompt('新 Attachment Key (例如: happy_face)：', `img_${Object.keys(slot.attachments).length + 1}`);
      if (!key || slot.attachments[key]) return;

      let items = "";
      if(this.layers) items = this.layers.map((L, i) => `${i}:${L.name.value}`).join('\n');
      
      const pick = prompt(`選擇圖片 Index:\n${items}`);
      const idx = Number(pick);

      if (Number.isNaN(idx) || idx < 0 || !this.layers || !this.layers[idx]) return;

      const newAttachment = {
        type: 'region',
        name: key,
        refId: idx,
        path: this.layers[idx].name.value,
        x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 100, height: 100
      };

      slot.attachments = { ...slot.attachments, [key]: newAttachment };
      this.changeAttachment(slot, key); // 自動切換
    },

    deleteSlot(idx) {
      if (!confirm(`確定刪除 Slot「${this.node.slots[idx].name}」？`)) return;
      this.node.slots.splice(idx, 1);
      this.reorderDone();
    },

    moveSlot(idx, dir) {
      const arr = this.node.slots;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= arr.length) return;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      this.reorderDone();
    },

    reorderDone() {
      this.$emit('slot-reorder', {
        boneId: this.node.id,
        slots: [...this.node.slots]
      });
    }
  }
};

// === Main App ===
const app = createApp({
  setup() {
    // --- 1. State (Refs & Reactives) ---
    const status = ref('準備中');
    const fileDropdown = ref(false);
    const editDropdown = ref(false);
    const selectedLayerId = ref(null);
    const layers = ref([]); // 專案圖層列表 (Project Layers)
    const psdLayers = ref([]);
    const points = ref([]);
    const activeTool = ref('grab-point'); // Default tool
    
    // UI State
    const expandedNodes = reactive([]);
    const weightValue = ref(0.0);
    const editingGroup = ref(null);
    const editName = ref("");
    
    // Timeline State
    const timelineList = ref([new Timeline2('main', 2.0)]);
    const selectedTimelineId = ref(0);
    const timelineLength = ref(1000);
    const playheadPosition = ref(0);
    const animationPlaying = ref(false);
    const timelineDragging = ref(false);

    // Pinia Store
    const counter = useCounterStore();
    const testWord = ref("test word");

    // --- 2. Computed ---
    const currentTimeline = computed(() => timelineList.value[selectedTimelineId.value]);
    const timeline2 = computed(() => timelineList.value[selectedTimelineId.value]);
    
    // 獲取當前選中 Layer 的 Vertex Group (帶有 refreshKey 依賴)
    const vertexGroupInfo = computed(() => {
      refreshKey.value; // Trigger dependency
      if (currentChosedLayer.value === null || !glsInstance.layers[currentChosedLayer.value]) return [];
      return glsInstance.layers[currentChosedLayer.value]?.vertexGroup.value;
    });

    // 獲取所有圖層供顯示
    const showLayers = computed(() => {
      refreshKey.value;
      return glsInstance.layers;
    });

    // --- 3. Methods ---

    const forceUpdate = () => {
      refreshKey.value++;
    };

    const closeAllDropdowns = () => {
      fileDropdown.value = false;
      editDropdown.value = false;
    };

    const toggleDropdown = (menu) => {
      if (menu === 'fileDropdown') {
        fileDropdown.value = true;
        editDropdown.value = false;
      } else {
        fileDropdown.value = false;
        editDropdown.value = true;
      }
    };

    const handleFileAction = (action) => {
      console.log("File Action:", action);
      closeAllDropdowns();
    };

    const handleEditAction = (action) => {
      console.log("Edit Action:", action);
      closeAllDropdowns();
    };

    // 處理點擊外部關閉選單
    const handleClickOutside = (e) => {
      const targetElement = e.target;
      if (!targetElement.closest('.menu-item')) {
        closeAllDropdowns();
      }
    };

    // --- Tool Selection Logic ---
    const selectTool = (tool) => {
      activeTool.value = tool;
      console.log("Switch to tool:", tool);

      if (tool === 'bone-animate') {
        // bonesInstance.restoreSkeletonVerticesFromLast();
      } else if (tool === 'bone-create') {
        // glsInstance.resetMeshToOriginal();
      } else if (tool === 'edit-points') {
        if(currentChosedLayer.value !== null) {
            bonesInstance.recoverSelectedVertex(currentChosedLayer);
        }
      } else if (tool === 'bone-clear') {
        bonesInstance.clearBones();
      } else if (tool === 'bone-save') {
        bonesInstance.saveBones();
      } else if (tool === 'bone-load') {
        bonesInstance.loadBones();
      }
      forceUpdate();
    };

    // --- Bone Tree Logic ---
    const toggleNode = (nodeId) => {
      const id = typeof nodeId === 'object' ? nodeId.id : nodeId;
      const idx = expandedNodes.indexOf(id);
      if (idx >= 0) expandedNodes.splice(idx, 1);
      else expandedNodes.push(id);
    };

    const handleNameClick = (payload) => {
      // payload: { type, id, data }
      console.log("Tree Item Clicked:", payload);
      let boneId = payload.id || payload; // 防呆
      lastSelectedBone.value = bonesInstance.findBoneById(boneId);
    };

    // --- Layer Selection ---
    const toggleLayerSelection = (index) => {
      console.log("Toggle layer selection:", index);
      if (selectedLayers.value.includes(index)) {
        const idx = selectedLayers.value.indexOf(index);
        selectedLayers.value.splice(idx, 1); // Mutate array directly for reactivity
        if (currentChosedLayer.value === index) {
          currentChosedLayer.value = -1;
        }
      } else {
        selectedLayers.value.push(index);
        currentChosedLayer.value = index;
      }
    };

    // --- Vertex Group Logic ---
    const toggleSelect = (name) => {
      // Toggle vertex group selection
      if (selectedGroups.value.includes(name)) {
        selectedGroups.value = [];
      } else {
        selectedGroups.value = [name];
      }
      
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (layer && layer.vertexGroup) {
        const group = layer.vertexGroup.value.find(g => g.name === name);
      //  if(group) console.log("Selected Group Data:", JSON.stringify(group));
      }
    };

    const onAdd = () => {
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;
      layer.vertexGroup.value.push({
        name: "group" + (layer.vertexGroup.value.length + 1),
        vertices: []
      });
    };

    const onRemove = () => {
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;
      layer.vertexGroup.value = layer.vertexGroup.value.filter(g => !selectedGroups.value.includes(g.name));
      selectedGroups.value = [];
    };

    const onAssign = () => {
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;
      const groupName = selectedGroups.value[0];
      const group = layer.vertexGroup.value.find(g => g.name === groupName);
      if (group) {
        group.vertices = selectedVertices.value.map(idx => ({ id: idx, weight: 0.0 }));
        console.log("Assigned vertices to group:", group.name);
      }
    };

    const onSelect = () => {
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;
      const groupName = selectedGroups.value[0];
      const group = layer.vertexGroup.value.find(g => g.name === groupName);
      if (group) {
        selectedVertices.value = group.vertices.map(v => v.id);
        console.log("Selected vertices:", selectedVertices.value);
      }
    };

    const setWeight = () => {
      const weight = parseFloat(weightValue.value);
      if (isNaN(weight) || weight < 0 || weight > 1) {
        alert("請輸入介於 0.0 到 1.0 之間的數值");
        return;
      }
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer || !layer.vertexGroup) return;
      const groupName = selectedGroups.value[0];
      const group = layer.vertexGroup.value.find(g => g.name === groupName);
      if (group && Array.isArray(group.vertices)) {
        group.vertices.forEach(v => v.weight = weight);
        console.log("Updated weights for group:", groupName);
      }
    };

    // --- Bone Weight Binding Logic (Moved from original methods) ---
    const bindingBoneWeight = (overlapFactor = 1) => {
      console.log("Binding bone weight...");
      if (skeletons.length === 0) {
        console.warn("No skeletons available for binding.");
        return;
      }
      
      const layer = glsInstance.layers[currentChosedLayer.value];
      if (!layer) {
        console.error("Invalid layer index for binding bone weight.");
        return;
      }
      
      const vertices = layer.vertices.value;
      const vertexCount = vertices.length / 4;
      const { canvasWidth, canvasHeight, width, height, top, left } = layer.transformParams;

      // Collect all bones
      const allBones = [];
      function collectBones(bones) {
        for (const bone of bones) {
          allBones.push(bone);
          if (bone.children) collectBones(bone.children);
        }
      }
      collectBones(skeletons[0].bones);

      // Reset groups
      layer.vertexGroup.value = [];
      const vertexGroupMap = new Map();

      // Helper: Distance to Segment
      function distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return { distance: Math.sqrt((px - x1)**2 + (py - y1)**2), t: 0 };
        
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return { distance: Math.sqrt((px - (x1 + t * dx))**2 + (py - (y1 + t * dy))**2), t };
      }

      // Helper: Influence Radius
      function getBoneInfluenceRadius(bone) {
        const t = bone.getGlobalTransform();
        const len = Math.sqrt((t.tail.x - t.head.x)**2 + (t.tail.y - t.head.y)**2);
        return len * 0.5 * overlapFactor;
      }

      // Calculation Loop
      for (let i = 0; i < vertexCount; i++) {
        const vx = vertices[i * 4];
        const vy = vertices[i * 4 + 1];
        
        // NDC -> Canvas Pixel
        const vxLayerPixel = (vx + 1.0) * 0.5 * width;
        const vyLayerPixel = (1.0 - vy) * 0.5 * height;
        const vxCanvasPixel = vxLayerPixel + left;
        const vyCanvasPixel = vyLayerPixel + top;

        const candidates = [];

        for (let j = 0; j < allBones.length; j++) {
          const bone = allBones[j];
          const gt = bone.getGlobalTransform();
          const res = distanceToSegment(vxCanvasPixel, vyCanvasPixel, gt.head.x, gt.head.y, gt.tail.x, gt.tail.y);
          const radius = getBoneInfluenceRadius(bone);

          if (res.distance <= radius) {
            const normalizedDist = res.distance / radius;
            const w = Math.pow(1.0 - normalizedDist, 3);
            candidates.push({ boneName: bone.name, distance: res.distance, weight: w });
          }
        }

        // Fallback: Closest bone if no candidates
        if (candidates.length === 0) {
          let minDist = Infinity;
          let closest = null;
          for(const bone of allBones) {
             const gt = bone.getGlobalTransform();
             const res = distanceToSegment(vxCanvasPixel, vyCanvasPixel, gt.head.x, gt.head.y, gt.tail.x, gt.tail.y);
             if(res.distance < minDist) {
                 minDist = res.distance;
                 closest = { boneName: bone.name, weight: 1.0 };
             }
          }
          if(closest) candidates.push(closest);
        }

        // Normalize weights
        let totalW = candidates.reduce((s, c) => s + c.weight, 0);
        if (totalW > 0) candidates.forEach(c => c.weight /= totalW);

        // Filter small weights & Re-normalize
        const finalBones = candidates.filter(c => c.weight >= 0.05);
        totalW = finalBones.reduce((s, c) => s + c.weight, 0);
        if (totalW > 0) finalBones.forEach(c => c.weight /= totalW);

        // Assign to groups
        finalBones.forEach(item => {
           if (!vertexGroupMap.has(item.boneName)) {
             vertexGroupMap.set(item.boneName, { name: item.boneName, vertices: [] });
           }
           vertexGroupMap.get(item.boneName).vertices.push({ id: i, weight: item.weight });
        });
      }

      layer.vertexGroup.value = Array.from(vertexGroupMap.values());
      console.log("Auto-binding complete.");
    };

    // --- File Handling & Rendering ---
    
    // PSD Upload Helper (Creates Texture from Layer Data)
    const createLayerTexture = (glCtx, layer) => {
        if (!layer || !layer.imageData) return null;
        const tex = glCtx.createTexture();
        glCtx.bindTexture(glCtx.TEXTURE_2D, tex);
        
        if (layer.imageData instanceof ImageData) {
            glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA, glCtx.RGBA, glCtx.UNSIGNED_BYTE, layer.imageData);
        } else if (ArrayBuffer.isView(layer.imageData)) {
            const canvas = document.createElement('canvas');
            canvas.width = layer.width;
            canvas.height = layer.height;
            const ctx = canvas.getContext('2d');
            const iData = ctx.createImageData(layer.width, layer.height);
            iData.data.set(layer.imageData);
            ctx.putImageData(iData, 0, 0);
            glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA, glCtx.RGBA, glCtx.UNSIGNED_BYTE, canvas);
        }
        
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR);
        glCtx.bindTexture(glCtx.TEXTURE_2D, null);
        return tex;
    };

    const handlePSDUpload = async (event) => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        
        let layersForTexture = [];
        const psdInfo = await processPSDFile(file);
        
        wholeImageWidth.value = psdInfo.width;
        wholeImageHeight.value = psdInfo.height;
        
        const glContext = gl.value;

        for (const layer of psdInfo.layers) {
            // Setup WebGL Texture
            layer.texture = createLayerTexture(glContext, layer);
            
            // Calculate NDC Vertices
            const left = layer.left || 0;
            const top = layer.top || 0;
            const right = left + (layer.width || psdInfo.width);
            const bottom = top + (layer.height || psdInfo.height);
            
            const ndcLeft = (left / psdInfo.width) * 2 - 1;
            const ndcRight = (right / psdInfo.width) * 2 - 1;
            const ndcTop = 1 - (top / psdInfo.height) * 2;
            const ndcBottom = 1 - (bottom / psdInfo.height) * 2;

            const layerVertices = [ndcLeft, ndcBottom, 0,0, ndcRight, ndcBottom, 1,0, ndcRight, ndcTop, 1,1, ndcLeft, ndcTop, 0,1];
            
            layer.vbo = glContext.createBuffer();
            glContext.bindBuffer(glContext.ARRAY_BUFFER, layer.vbo);
            glContext.bufferData(glContext.ARRAY_BUFFER, new Float32Array(layerVertices), glContext.STATIC_DRAW);
            
            layer.ebo = glContext.createBuffer();
            glContext.bindBuffer(glContext.ELEMENT_ARRAY_BUFFER, layer.ebo);
            glContext.bufferData(glContext.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 0,2,3]), glContext.STATIC_DRAW);

            layersForTexture.push({
                imageData: layer.imageData,
                width: layer.width,
                height: layer.height,
                left: layer.left || -1,
                top: layer.top || 1,
                name: layer.name || 'Layer',
                opacity: layer.opacity || 1.0,
                blendMode: layer.blendMode || 'normal'
            });
        }
        layerForTextureWebgl.value = layersForTexture;
        console.log("PSD Processed. Layers:", layersForTexture.length);
        
      } catch (error) {
        console.error("PSD Upload Error:", error);
      }
    };

    const firstImage = async () => {
      if (!gl.value) return;
      await pngRender('./png3.png', selectedLayers, wholeImageHeight, wholeImageWidth);
      forceUpdate();
      
      const passes = [
        makeRenderPass(renderGridOnly, gl.value, colorProgram.value, glsInstance.layers[currentChosedLayer.value], glsInstance.getLayerSize(), currentChosedLayer.value, selectedVertices.value),
        makeRenderPass(renderWeightPaint, gl.value, weightPaintProgram.value, selectedGroups.value[0], glsInstance.layers[currentChosedLayer.value], true), // assuming isWeightPaintMode is true
        makeRenderPass(renderMeshSkeleton, gl.value, skeletonProgram.value, meshSkeleton, bonesInstance, mousePressed, activeTool)
      ];
      
      setCurrentJobName("png");
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers.value, passes, "png");
    };

    const psdImage = async () => {
        if(!gl.value) return;
        await psdRender(selectedLayers, wholeImageHeight.value, wholeImageWidth.value);
        forceUpdate();
        
        const passes = [
            makeRenderPass(renderGridOnly, gl.value, colorProgram.value, glsInstance.layers[currentChosedLayer.value], glsInstance.getLayerSize(), currentChosedLayer.value, selectedVertices.value),
            makeRenderPass(renderWeightPaint, gl.value, weightPaintProgram.value, selectedGroups.value[0], glsInstance.layers[currentChosedLayer.value]),
            makeRenderPass(renderMeshSkeleton, gl.value, skeletonProgram.value, meshSkeleton, bonesInstance, mousePressed, activeTool)
        ];
        
        setCurrentJobName("psd");
        render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers.value, passes, "psd");
    };

    // --- Timeline Logic ---
    const addTimeline = () => {
      const newName = `動畫軸 ${timelineList.value.length + 1}`;
      timelineList.value.push(new Timeline2(newName, 2.0));
      selectedTimelineId.value = timelineList.value.length - 1;
    };

    const removeTimeline = () => {
      if (timelineList.value.length > 1) {
        timelineList.value.splice(selectedTimelineId.value, 1);
        selectedTimelineId.value = Math.max(0, selectedTimelineId.value - 1);
      }
    };

    const addKeyframe = () => {
      timeline2.value.addKeyframe(bonesInstance.GetLastSelectedBone?.(), playheadPosition.value);
    };

    const removeKeyframe = () => {
        // Implement remove logic here
    };

    const selectTimeline = (event) => {
        const timelineRect = event.currentTarget.getBoundingClientRect();
        let offsetX = event.clientX - timelineRect.left;
        const clampedX = Math.max(0, Math.min(offsetX, timelineRect.width));
        
        const updateTimeline = () => {
            timeline2.value.update(playheadPosition.value, skeletons);
            bonesInstance.updatePoseMesh(gl.value);
            forceUpdate();
        };

        if(event.type === 'mousedown') {
            timelineDragging.value = true;
            playheadPosition.value = clampedX;
            updateTimeline();
            
            const upHandler = () => {
                timelineDragging.value = false;
                document.removeEventListener('mouseup', upHandler);
                document.removeEventListener('mousemove', moveHandler);
            };
            const moveHandler = (e) => {
                if(timelineDragging.value) {
                    const x = e.clientX - timelineRect.left;
                    playheadPosition.value = Math.max(0, Math.min(x, timelineRect.width));
                    updateTimeline();
                }
            };
            document.addEventListener('mouseup', upHandler);
            document.addEventListener('mousemove', moveHandler);
        }
    };

    const playAnimation = () => {
        console.log("Playing Animation...");
        // Implement play loop here using requestAnimationFrame
    };

    // --- Export/Save ---
    const exportSkeletonToSpineJson = () => {
        const result = meshSkeleton.exportSpineJson();
        console.log("Spine JSON:", JSON.stringify(result));
    };

    const saveSpineJson = () => {
        meshSkeleton.exportToFile();
        // Also export Atlas logic here...
    };

    // --- Lifecycle ---
    onMounted(() => {
        document.addEventListener('click', handleClickOutside);
        window.addEventListener('keydown', (e) => {
            if(e.key === 'Shift') isShiftPressed.value = true;
            if(e.key === 'Control') isCtrlPressed.value = true; // Use ref in globalVars if possible
        });
        window.addEventListener('keyup', (e) => {
            if(e.key === 'Shift') isShiftPressed.value = false;
            if(e.key === 'Control') isCtrlPressed.value = false;
        });
    });

    onUnmounted(() => {
        document.removeEventListener('click', handleClickOutside);
        // Clean up global listeners if necessary
    });

    // --- 4. Provide (Dependency Injection for Child Components) ---
    provide('activeTool', activeTool);
    provide('selectTool', selectTool);
    provide('bindingBoneWeight', bindingBoneWeight);
    provide('skeletons', skeletons);
    provide('lastSelectedBone', lastSelectedBone);
    provide('selectedItem', ref(null)); // Placeholder
    provide('showLayers', showLayers); // Computed
    provide('selectedLayers', selectedLayers); // From globalVars
    provide('chosenLayers', ref([])); // Need separate ref for this or reuse global
    provide('selectedGroups', selectedGroups);
    provide('currentChosedLayer', currentChosedLayer);
    provide('vertexGroupInfo', vertexGroupInfo);
    provide('editingGroup', editingGroup);
    provide('weightValue', weightValue);
    
    // Timeline
    provide('timelineList', timelineList);
    provide('selectedTimelineId', selectedTimelineId);
    provide('timeline2', timeline2);
    provide('currentTimeline', currentTimeline);
    provide('playheadPosition', playheadPosition);
    provide('timelineLength', timelineLength);
    
    // Functions
    provide('onAdd', onAdd);
    provide('onRemove', onRemove);
    provide('onAssign', onAssign);
    provide('onSelect', onSelect);
    provide('setWeight', setWeight);
    provide('addTimeline', addTimeline);
    provide('removeTimeline', removeTimeline);
    provide('addKeyframe', addKeyframe);
    provide('removeKeyframe', removeKeyframe);
    provide('handlePSDUpload', handlePSDUpload);
    provide('psdImage', psdImage);
    provide('firstImage', firstImage);
    provide('playAnimation', playAnimation);
    provide('exportSkeletonToSpineJson', exportSkeletonToSpineJson);
    provide('saveSpineJson', saveSpineJson);
    provide('selectTimeline', selectTimeline);
    provide('toggleNode', toggleNode);
    provide('expandedNodes', expandedNodes);
    provide('handleNameClick', handleNameClick);
    provide('toggleLayerSelection', toggleLayerSelection);
    provide('toggleSelect', toggleSelect);
    
    // --- Return for Template ---
    return {
      status,
      fileDropdown,
      editDropdown,
      toggleDropdown,
      handleFileAction,
      handleEditAction,
      counter,
      testWord,
      // expose other necessary variables to app.html template if needed
    };
  }
});

// === Router Setup ===
const routes = [
  { path: '/', component: Home },
  { path: '/allEditor', component: allEditor },
  { path: '/editor', component: Editor },
  { path: '/page', component: Page },
  { path: '/meshEditor', component: meshEditor },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

const pinia = createPinia();
app.component('tree-item', TreeItem);
app.use(pinia);
app.use(router);

export default app;