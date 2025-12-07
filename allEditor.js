// allEditor.js
import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, onUnmounted, h, nextTick, inject, computed, watch, reactive, toRaw } = Vue;

import {
  globalVars as v,
  triggerRefresh,
  loadHtmlPage,
  convertToNDC,
  selectedLayers,
  mousePressed,
  isShiftPressed,
  forceUpdate,
  initGlAlready,
  wholeImageWidth,
  wholeImageHeight,
  lastLoadedImageType,
  meshs,
  getRawXY
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
  psdHello,
  processPSDFile
} from './psd.js';

import { Timeline2 } from './timeline2.js';

import {
  shaders,
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
  pngRender,
  psdRender,
  psdRenderAgain,
  pngRenderAgain,
  renderMeshSkeleton,
  renderMeshSkeleton2,
  renderWeightPaint,
  makeRenderPass,
  bindGl,
  clearTexture,
  pngLoadTexture,
  layerForTextureWebgl,
  restoreWebGLResources,
  renderOutBoundary,
  getMouseLocalPos,
  getClosestVertex
} from './useWebGL.js';

import glsInstance from './useWebGL.js';

// =========================================================
// 🌳 TreeItem 組件
// =========================================================
const TreeItem = {
  name: 'TreeItem',
  props: ['node', 'expandedNodes', 'selectedItem', 'layers'],
  emits: ['toggle-node', 'item-click', 'slot-visible-change', 'slot-attachment-change', 'slot-reorder'],
  template: `
    <div class="tree-item">
      <div class="tree-item-header" style="display:flex;align-items:center;">
        <span v-if="hasChildren||hasSlots" style="cursor:pointer;width:16px" @click.stop="toggleNode(node.id)">{{ isExpanded?'▼':'▶' }}</span>
        <span v-else style="display:inline-block;width:16px"/>
        <span style="cursor:pointer;margin-left:4px" :style="{backgroundColor: selectedItem?.type==='bone'&&selectedItem?.id===node.id?'#444':'transparent', color: selectedItem?.type==='bone'&&selectedItem?.id===node.id?'#fff':'inherit'}" @click="selectItem({type:'bone',id:node.id, data: node})">🦴 {{ node.name || '(未命名骨骼)' }}</span>
        <button @click.stop="addSlot(0)" title="新增 Slot" style="font-size:10px; margin-left:8px; cursor:pointer;">➕ Slot</button>
      </div>
      <div v-if="isExpanded" class="tree-item-children" style="padding-left:20px; border-left: 1px dashed #ccc;">
        <div v-for="(slot,idx) in node.slots" :key="slot.id" style="display:flex;align-items:center;cursor:pointer;padding:2px 0; border-bottom:1px solid #eee;" :style="{backgroundColor: selectedItem?.type==='slot'&&selectedItem?.id===slot.id?'#e0e0e0':'transparent'}" @click="selectItem({type:'slot',id:slot.id, data: slot})">
          <span style="font-size:12px; margin-right:5px;" @click.stop="toggleSlotVisible(slot)" :title="slot.visible?'隱藏':'顯示'">{{ slot.visible?'👁':'🚫' }}</span>
          <span style="font-size:13px;">🎯 {{ slot.name }}</span>
          <span style="font-size:10px; color:#888; margin-left:4px;">{{ slot.blendMode === 'normal' ? '' : '['+slot.blendMode+']' }}</span>
          <select v-if="slot.attachments && Object.keys(slot.attachments).length" style="margin-left:6px;font-size:11px;max-width:80px;" :value="slot.attachmentKey||''" @change="changeAttachment(slot,$event.target.value)" @click.stop>
            <option value="">(空)</option>
            <option v-for="k in Object.keys(slot.attachments)" :key="k" :value="k">{{ k }}</option>
          </select>
          <button @click.stop="appendAttachment(slot)" title="新增 Attachment" style="font-size:10px; margin-left:2px; cursor:pointer;">📎+</button>
          <span style="margin-left:auto;display:flex;gap:2px;font-size:12px">
            <button @click.stop="moveSlot(idx,-1)" :disabled="idx===0" title="上移">⬆</button>
            <button @click.stop="moveSlot(idx,1)"  :disabled="idx===node.slots.length-1" title="下移">⬇</button>
            <button @click.stop="deleteSlot(idx)" title="刪除 Slot">🗑</button>
          </span>
        </div>
        <tree-item v-for="c in node.children" :key="c.id" :node="c" :expanded-nodes="expandedNodes" :selected-item="selectedItem" :layers="layers" @toggle-node="$emit('toggle-node',$event)" @item-click="$emit('item-click',$event)" @slot-visible-change="$emit('slot-visible-change',$event)" @slot-attachment-change="$emit('slot-attachment-change',$event)" @slot-reorder="$emit('slot-reorder',$event)"/>
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
    toggleSlotVisible(slot) { slot.visible = !slot.visible; this.$emit('slot-visible-change', { slotId: slot.id, visible: slot.visible }); },
    changeAttachment(slot, key) { const validKey = key === "" ? null : key; slot.attachmentKey = validKey; this.$emit('slot-attachment-change', { slotId: slot.id, key: validKey, attachment: validKey ? slot.attachments[validKey] : null }); },
    addSlot(insertBeforeIdx) {
      const name = prompt('新 Slot 名稱：', 'newSlot'); if (!name) return;
      let items = ""; if (this.layers && Array.isArray(this.layers) && this.layers.length > 0) { items = this.layers.map((L, i) => `${i}: ${L.name?.value || L.name}`).join('\n'); } else { items = "無可用圖層"; }
      const pick = prompt(`選擇初始圖片 Index:\n${items}`, "0"); const idx = Number(pick); const hasValidLayer = !Number.isNaN(idx) && idx >= 0 && this.layers && this.layers[idx];
      const newSlot = { id: `slot_${Date.now()}`, name: name, boneId: this.node.id, visible: true, blendMode: 'normal', color: { r: 1, g: 1, b: 1, a: 1 }, attachmentKey: hasValidLayer ? 'default' : null, attachments: {} };
      if (hasValidLayer) { newSlot.attachments['default'] = { type: 'region', name: 'default', refId: idx, path: this.layers[idx].name.value || this.layers[idx].name, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 100, height: 100 }; }
      if (!this.node.slots) this.node.slots = []; this.node.slots.splice(this.node.slots.length, 0, newSlot); this.reorderDone();
    },
    appendAttachment(slot) {
      const key = prompt('新 Attachment Key：', `img_${Object.keys(slot.attachments).length + 1}`); if (!key || slot.attachments[key]) return;
      let items = ""; if (this.layers && Array.isArray(this.layers)) { items = this.layers.map((L, i) => `${i}: ${L.name?.value || L.name}`).join('\n'); }
      const pick = prompt(`選擇圖片 Index:\n${items}`); const idx = Number(pick); if (Number.isNaN(idx) || idx < 0 || !this.layers || !this.layers[idx]) return;
      const newAttachment = { type: 'region', name: key, refId: idx, path: this.layers[idx].name.value || this.layers[idx].name, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 100, height: 100 };
      slot.attachments = { ...slot.attachments, [key]: newAttachment }; this.changeAttachment(slot, key);
    },
    deleteSlot(idx) { if (!confirm(`確定刪除 Slot？`)) return; this.node.slots.splice(idx, 1); this.reorderDone(); },
    moveSlot(idx, dir) { const arr = this.node.slots; const newIdx = idx + dir; if (newIdx < 0 || newIdx >= arr.length) return;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]; this.reorderDone(); },
    reorderDone() { this.$emit('slot-reorder', { boneId: this.node.id, slots: [...this.node.slots] }); }
  }
};

// =========================================================
// 📄 AllEditor 主要組件
// =========================================================
export const allEditor = defineComponent({
  name: 'allEditor',
  components: { TreeItem },
  setup() {
    console.log("Setting up AllEditor page...");

    const counter = useCounterStore();
    const renderFn = ref(null);

    // === Injections ===
    const activeTool = inject('activeTool', ref('grab-point'));
    const selectTool = inject('selectTool', () => { });
    const bindingBoneWeight = inject('bindingBoneWeight', () => { });

    const skeletons = inject('skeletons', ref([]));
    const selectedItem = inject('selectedItem', ref(null));
    const showLayers = inject('showLayers', ref([]));
    const chosenLayers = inject('chosenLayers', ref([]));
    const selectedGroups = inject('selectedGroups', ref([]));
    const lastSelectedBone = inject('lastSelectedBone', ref(null));
    const currentChosedLayer = inject('currentChosedLayer', ref(null));
    const vertexGroupInfo = inject('vertexGroupInfo', ref(null));
    const weightValue = inject('weightValue', ref(0));

    const timelineList = inject('timelineList', ref([]));
    const selectedTimelineId = inject('selectedTimelineId', ref(0));
    const timeline2 = inject('timeline2', computed(() => timelineList.value[selectedTimelineId.value]));
    const currentTimeline = inject('currentTimeline', computed(() => timelineList.value[selectedTimelineId.value]));
    const timelineLength = inject('timelineLength', ref(1000));
    const playheadPosition = inject('playheadPosition', ref(0));

    // Inject Functions
    const onAdd = inject('onAdd', () => { });
    const onRemove = inject('onRemove', () => { });
    const onAssign = inject('onAssign', () => { });
    const onSelect = inject('onSelect', () => { });
    const setWeight = inject('setWeight', () => { });
    const choseTimelineId = inject('choseTimelineId', () => { });
    const renameTimeline = inject('renameTimeline', () => { });
    const addTimeline = inject('addTimeline', () => { });
    const removeTimeline = inject('removeTimeline', () => { });
    const addKeyframe = inject('addKeyframe', () => { });
    const removeKeyframe = inject('removeKeyframe', () => { });

    const exportSkeletonToSpineJson = inject('exportSkeletonToSpineJson', () => { });
    const saveSpineJson = inject('saveSpineJson', () => { });
    const selectTimeline = inject('selectTimeline', () => { });
    const expandedNodes = inject('expandedNodes', []);
    const toggleNode = inject('toggleNode', () => { });
    const handleNameClick = inject('handleNameClick', () => { });
    const toggleLayerSelection = inject('toggleLayerSelection', () => { });
    const toggleSelect = inject('toggleSelect', () => { });


    // === Local State ===
    const selectedVertex = ref(-1);
    const isCtrlPressed = ref(false);
    const testCountQQ = ref(0);
    const layoutState = reactive({ rightPanelWidth: 280, layersHeight: 200, isResizing: false });
    const layers = computed(() => glsInstance.layers || []);

    const editState = reactive({ editingGroup: null, editName: "" });
    const isWeightPaintMode = ref(false);

    // === Animation Logic ===
    const isPlaying = ref(false);
    let animationReqId = null;

    const animationLoop = () => {
      if (!isPlaying.value) return;
      playheadPosition.value += 5;
      if (playheadPosition.value > timelineLength.value) playheadPosition.value = 0;

      if (timeline2.value) timeline2.value.update(playheadPosition.value, skeletons);
      if (gl.value) {
        bonesInstance.updatePoseMesh(gl.value);
        bonesInstance.updateSlotAttachments();
      }
      forceUpdate();
      animationReqId = requestAnimationFrame(animationLoop);
    };

    const playAnimation = () => {
      if (isPlaying.value) {
        isPlaying.value = false;
        if (animationReqId) cancelAnimationFrame(animationReqId);
      } else {
        isPlaying.value = true;
        animationLoop();
      }
    };

    // =========================================================
    // 📦 File Loading & Rendering
    // =========================================================

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
          layer.texture = createLayerTexture(glContext, layer);

          const left = layer.left || 0;
          const top = layer.top || 0;
          const right = left + (layer.width || psdInfo.width);
          const bottom = top + (layer.height || psdInfo.height);

          const ndcLeft = (left / psdInfo.width) * 2 - 1;
          const ndcRight = (right / psdInfo.width) * 2 - 1;
          const ndcTop = 1 - (top / psdInfo.height) * 2;
          const ndcBottom = 1 - (bottom / psdInfo.height) * 2;

          const layerVertices = [ndcLeft, ndcBottom, 0, 0, ndcRight, ndcBottom, 1, 0, ndcRight, ndcTop, 1, 1, ndcLeft, ndcTop, 0, 1];

          layer.vbo = glContext.createBuffer();
          glContext.bindBuffer(glContext.ARRAY_BUFFER, layer.vbo);
          glContext.bufferData(glContext.ARRAY_BUFFER, new Float32Array(layerVertices), glContext.STATIC_DRAW);

          layer.ebo = glContext.createBuffer();
          glContext.bindBuffer(glContext.ELEMENT_ARRAY_BUFFER, layer.ebo);
          glContext.bufferData(glContext.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), glContext.STATIC_DRAW);

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
      await pngRender();
      forceUpdate();

      const passes = [
        makeRenderPass(renderGridOnly, gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices),
        makeRenderPass(renderWeightPaint, gl.value, weightPaintProgram.value, selectedGroups.value[0], glsInstance.layers[currentChosedLayer.value], isWeightPaintMode.value),
        makeRenderPass(renderMeshSkeleton2, gl.value, skeletonProgram.value, meshSkeleton, bonesInstance, mousePressed, activeTool, wholeImageWidth.value, wholeImageHeight.value),
        makeRenderPass(renderOutBoundary, gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices)
      ];

      setCurrentJobName("png");

      // 🔥 [修正] 使用 selectedLayers (Ref)，而非 selectedLayers.value
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers, [() => {
        passes.forEach(p => p());
      }], "png");
    };

    const psdImage = async () => {
      if (!gl.value) return;
      await psdRender(selectedLayers, wholeImageHeight.value, wholeImageWidth.value);

      // 🔥 [新增] 自動將所有新圖層設為可見 (Checked)
      // 確保 selectedLayers 包含所有新圖層的索引
      selectedLayers.value = glsInstance.layers.map((_, index) => index);

      forceUpdate();

      const passes = [
        makeRenderPass(renderGridOnly, gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices),
        makeRenderPass(renderWeightPaint, gl.value, weightPaintProgram.value, selectedGroups.value[0], glsInstance.layers[currentChosedLayer.value], isWeightPaintMode.value),
        makeRenderPass(renderMeshSkeleton2, gl.value, skeletonProgram.value, meshSkeleton, bonesInstance, mousePressed, activeTool, wholeImageWidth.value, wholeImageHeight.value),
        makeRenderPass(renderOutBoundary, gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices)
      ];

      setCurrentJobName("psd");

      // 🔥 [修正] 確保傳入 selectedLayers Ref 物件
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers, [() => {
        passes.forEach(p => p());
      }], "psd");
    };

    // =========================================================
    // 📦 Export & Atlas Packing Logic
    // =========================================================

    const extractTextureFromWebGL = (glCtx, webglTex, width, height) => {
      if (!webglTex || width <= 0 || height <= 0) return null;
      const fb = glCtx.createFramebuffer();
      glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fb);
      glCtx.framebufferTexture2D(glCtx.FRAMEBUFFER, glCtx.COLOR_ATTACHMENT0, glCtx.TEXTURE_2D, webglTex, 0);

      if (glCtx.checkFramebufferStatus(glCtx.FRAMEBUFFER) !== glCtx.FRAMEBUFFER_COMPLETE) {
        glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null); glCtx.deleteFramebuffer(fb); return null;
      }

      const pixels = new Uint8Array(width * height * 4);
      glCtx.readPixels(0, 0, width, height, glCtx.RGBA, glCtx.UNSIGNED_BYTE, pixels);
      glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null); glCtx.deleteFramebuffer(fb);

      // 🔥 恢復翻轉 Y 軸 (為了匯出的 PNG 正確)
      const flippedPixels = new Uint8ClampedArray(width * height * 4);
      const rowSize = width * 4;
      for (let y = 0; y < height; y++) {
        const srcRow = y * rowSize;
        const dstRow = (height - 1 - y) * rowSize;
        flippedPixels.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
      }

      return new ImageData(flippedPixels, width, height);
    };

    const packTextureAtlas = (layers) => {
      const glCtx = gl.value;
      const canvas = document.createElement('canvas');

      const itemsToPack = layers.map((layer, index) => {
        const texData = texture.value && texture.value[index] ? toRaw(texture.value[index]) : null;

        let rawImage = layer.imageData || layer.image;
        if (!rawImage && texData) {
          rawImage = texData.data || texData.image;
        }
        rawImage = toRaw(rawImage);

        const width = layer.width || (texData ? texData.width : 0);
        const height = layer.height || (texData ? texData.height : 0);

        let imageData = null;
        if (texData && texData.tex) {
          imageData = extractTextureFromWebGL(glCtx, texData.tex, width, height);
        }

        return {
          name: layer.name.value || layer.name,
          width,
          height,
          imageData: imageData || rawImage
        };
      }).filter(item => item.imageData && item.width > 0 && item.height > 0);

      let totalArea = 0;
      let maxWidth = 0;
      itemsToPack.forEach(item => { totalArea += item.width * item.height; maxWidth = Math.max(maxWidth, item.width); });

      let size = 512;
      while (size * size < totalArea * 1.2 || size < maxWidth) size *= 2;

      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size, size);

      let currentX = 0; let currentY = 0; let rowHeight = 0;
      const regions = [];

      itemsToPack.forEach(item => {
        if (currentX + item.width > size) { currentX = 0; currentY += rowHeight; rowHeight = 0; }
        try {
          if (item.imageData instanceof ImageData) {
            ctx.putImageData(item.imageData, currentX, currentY);
          } else if (item.imageData instanceof HTMLImageElement || item.imageData instanceof HTMLCanvasElement || item.imageData instanceof ImageBitmap) {
            ctx.drawImage(item.imageData, currentX, currentY);
          } else if (item.imageData && (item.imageData instanceof Uint8Array || item.imageData instanceof Uint8ClampedArray)) {
            const newData = new ImageData(new Uint8ClampedArray(item.imageData), item.width, item.height);
            ctx.putImageData(newData, currentX, currentY);
          }
        } catch (e) { console.error(`Error drawing ${item.name}`, e); }

        regions.push({ name: item.name, x: currentX, y: currentY, width: item.width, height: item.height, index: -1 });
        currentX += item.width;
        rowHeight = Math.max(rowHeight, item.height);
      });

      return { canvas, regions, width: size, height: size };
    };

    const generateAtlasText = (filename, width, height, regions) => {
      let text = `${filename}\nsize: ${width},${height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n`;
      regions.forEach(r => {
        text += `${r.name}\n  bounds: ${r.x}, ${r.y}, ${r.width}, ${r.height}\n`;
      });
      return text;
    };

    const handleExportSpine = () => {
      console.log("Exporting Spine Data (JSON + Binary)...");
      const atlasName = "skeleton.atlas";
      const imageName = "skeleton.png";
      const jsonName = "skeleton.json";
      const binaryName = "skeleton.skel";

      const { canvas, regions, width, height } = packTextureAtlas(glsInstance.layers);
      const atlasContent = generateAtlasText(imageName, width, height, regions);

      const jsonResult = meshSkeleton.exportSpineJson(1.0, timeline2.value, glsInstance.layers);
      const binaryResult = meshSkeleton.exportSpineBinary(1.0, timeline2.value, glsInstance.layers);

      const downloadFile = (content, filename, type) => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };

      downloadFile(JSON.stringify(jsonResult, null, 2), jsonName, "application/json");
      downloadFile(binaryResult, binaryName, "application/octet-stream");
      downloadFile(atlasContent, atlasName, "text/plain");

      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = imageName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, 'image/png');

      console.log("✅ Export Complete");
    };

    // === Helpers & Event Handlers ===
    const handleGroupClick = (name) => {
      toggleSelect(name);
      if (selectedGroups.value.includes(name)) isWeightPaintMode.value = true;
      else isWeightPaintMode.value = false;
      forceUpdate();
    };

    const startEdit = (name) => {
      editState.editingGroup = name;
      editState.editName = name;
    };

    const confirmEdit = (group) => {
      if (!group) return;
      const newName = editState.editName.trim();
      if (newName !== "" && newName !== group.name) {
        const oldName = group.name;
        group.name = newName;
        if (meshSkeleton) {
          let targetBone = null;
          meshSkeleton.forEachBone(b => { if (b.name === oldName) targetBone = b; });
          if (targetBone) targetBone.name = newName;
        }
        if (selectedGroups.value.includes(oldName)) selectedGroups.value = [newName];
        triggerRefresh();
      }
      editState.editingGroup = null;
      editState.editName = "";
    };

    // === Mouse Handlers ===
    let isDragging = false;
    let localSelectedVertex = -1;
    let startPosX = 0; let startPosY = 0;
    let useMultiSelect = true;
    let dragStartX = 0; let dragStartY = 0;
    let selectedBoundaryIndex = -1;

    const handleMouseDown = (e) => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;
      mousePressed.value = e.button;
      const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, canvas.closest('.canvas-area'));
      const { x: rawX, y: rawY } = getRawXY(e, canvas, canvas.closest('.canvas-area'));
      startPosX = xNDC; startPosY = yNDC;

      if (e.button === 0 || e.button === 2) {
        if (activeTool.value === 'grab-point') {
          const currentLayer = glsInstance.layers[currentChosedLayer.value];
          if (!currentLayer) return;
          const { x: localMouseX, y: localMouseY } = getMouseLocalPos(xNDC, yNDC, currentLayer);
          const vertices = currentLayer.vertices.value;
          if (!useMultiSelect) {
            let minDist = Infinity;
            localSelectedVertex = -1;
            const thresholdSq = 0.05 * 0.05;
            for (let i = 0; i < vertices.length; i += 4) {
              const dx = vertices[i] - localMouseX;
              const dy = vertices[i + 1] - localMouseY;
              const distSq = dx * dx + dy * dy;
              if (distSq < minDist) { minDist = distSq; localSelectedVertex = i / 4; }
            }
            if (minDist < thresholdSq) { isDragging = true; selectedVertex.value = localSelectedVertex; }
          } else {
            let hitVertex = -1;
            const thresholdSq = 0.05 * 0.05;
            for (let idx of selectedVertices.value) {
              const vx = vertices[idx * 4];
              const vy = vertices[idx * 4 + 1];
              const dx = vx - localMouseX;
              const dy = vy - localMouseY;
              if ((dx * dx + dy * dy) < thresholdSq) { hitVertex = idx; break; }
            }
            if (hitVertex !== -1) { isDragging = true; dragStartX = xNDC; dragStartY = yNDC; }
          }
        }
        else if (activeTool.value === 'select-points') {
          bonesInstance.handleSelectPointsMouseDown(xNDC, yNDC, rawX, rawY);
          isDragging = true;
        } else if (activeTool.value === 'bone-create') {
          if (e.button === 2) { bonesInstance.handleMeshBoneEditMouseDown(rawX, rawY); isDragging = true; }
          else { bonesInstance.handleMeshBoneCreateMouseDown(rawX, rawY, isShiftPressed.value); isDragging = true; }
        } else if (activeTool.value === 'bone-animate') {
          bonesInstance.GetCloestBoneAsSelectBone(rawX, rawY, false);
          isDragging = true;
        } else if (activeTool.value === 'edit-boundary') {
          if (e.button === 0) {
            selectedBoundaryIndex = glsInstance.handleBoundaryInteraction(xNDC, yNDC, glsInstance.layers, currentChosedLayer);
            isDragging = true;
          }
        }
      }
    };

    const handleMouseMove = (e) => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;
      const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, canvas.closest('.canvas-area'));
      const { x: rawX, y: rawY } = getRawXY(e, canvas, canvas.closest('.canvas-area'));

      if (!isDragging) {
        const isCreateMode = (activeTool.value === 'bone-create');
        bonesInstance.GetCloestBoneAsHoverBone(rawX, rawY, isCreateMode);
        return;
      }

      if (activeTool.value === 'grab-point' && isDragging) {
        bonesInstance.moveSelectedVertex(currentChosedLayer, useMultiSelect, localSelectedVertex, gl.value, xNDC, yNDC, dragStartX, dragStartY);
        dragStartX = xNDC; dragStartY = yNDC;
        forceUpdate();
      } else if (activeTool.value === 'select-points') {
        bonesInstance.handleSelectPointsMouseMove(xNDC, yNDC, rawX, rawY);
      } else if (activeTool.value === 'bone-create') {
        if (e.buttons === 2) bonesInstance.meshBoneEditMouseMove(rawX, rawY);
        else bonesInstance.meshboneCreateMouseMove(rawX, rawY);
      } else if (activeTool.value === 'bone-animate') {
        bonesInstance.handleMeshBoneAnimateMouseDown(rawX, rawY);
        bonesInstance.updatePoseMesh(gl.value);
        bonesInstance.updateSlotAttachments();
        forceUpdate();
      } else if (activeTool.value === 'edit-boundary') {
        if (selectedBoundaryIndex !== -1 && e.button === 0) {
          glsInstance.updateBoundary(xNDC, yNDC, selectedBoundaryIndex, glsInstance.layers[currentChosedLayer.value], isShiftPressed.value);
        }
      }
    };

    const handleMouseUp = (e) => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;
      const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, canvas.closest('.canvas-area'));
      const { x: rawX, y: rawY } = getRawXY(e, canvas, canvas.closest('.canvas-area'));
      mousePressed.value = e.button;

      if (activeTool.value === 'bone-create' && isDragging) {
        if (e.button === 2) bonesInstance.meshBoneEditMouseMove(rawX, rawY);
        else bonesInstance.MeshBoneCreate(rawX, rawY);
      } else if (activeTool.value === 'select-points') {
        if (isDragging) bonesInstance.handleSelectPointsMouseUp(xNDC, yNDC, currentChosedLayer.value, isShiftPressed.value, isCtrlPressed.value);
      } else if (activeTool.value === 'edit-boundary') {
        selectedBoundaryIndex = -1;
      }
      isDragging = false;
      selectedVertex.value = -1;
      forceUpdate();
    };

    const handleWheel = (e) => { e.preventDefault(); };

    // === Helpers ===
    const drawGlCanvas = async () => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;
      const webglContext = canvas.getContext('webgl2');
      if (gl.value) { gl.value = null; }
      gl.value = webglContext;

      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('mouseleave', handleMouseUp);
      canvas.addEventListener('wheel', handleWheel);

      program.value = glsInstance.createProgram(gl.value, shaders.vertex, shaders.fragment);
      colorProgram.value = glsInstance.createProgram(gl.value, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = glsInstance.createProgram(gl.value, shaders.skeletonVertex, shaders.skeletonFragment);
      weightPaintProgram.value = glsInstance.createProgram(gl.value, shaders.weightPaintVertex, shaders.weightPaintFragment);
      skinnedProgram.value = glsInstance.createProgram(gl.value, shaders.skinnedVertex, shaders.skinnedFragment);
    };

    const startResize = (type, event) => { /* ... Resize logic ... */ };
    const onLayerCheckChange = (index, event) => {
      const isChecked = event.target.checked;

      if (isChecked) {
        // 勾選：加入顯示列表
        if (!selectedLayers.value.includes(index)) {
          selectedLayers.value.push(index);
        }
      } else {
        // 取消勾選：從顯示列表移除
        const idx = selectedLayers.value.indexOf(index);
        if (idx > -1) {
          selectedLayers.value.splice(idx, 1);
        }
      }
      // 建議排序一下，確保渲染順序（選用）
      selectedLayers.value.sort((a, b) => a - b);
      forceUpdate();
    };

    // 2. 點擊名稱：只切換 "當前編輯圖層" (Active Layer)
    // 這會改變 renderGridOnly 的目標，從而顯示該圖層的頂點，隱藏其他的
    const selectLayer = (index) => {
      console.log("Switch editing layer to:", index);

      // 設定當前編輯的圖層
      currentChosedLayer.value = index;

      // (選項) 自動勾選：通常點選編輯時，使用者會希望看到它
      // 如果你不希望點選名稱時自動把圖層變為可見，請註解掉下面這三行
      if (!selectedLayers.value.includes(index)) {
        selectedLayers.value.push(index);
        selectedLayers.value.sort((a, b) => a - b);
      }

      // 重置選取的頂點，避免切換圖層後還有殘留的選取點
      selectedVertices.value = [];

      forceUpdate();
    };
    const slotVisibleChange = ({ slotId, visible }) => {
      console.log(`Slot ${slotId} visible: ${visible}`);
      bonesInstance.updateSlotAttachments();
      forceUpdate();
    };
    const slotAttachmentChange = ({ slotId, key }) => {
      console.log(`Slot ${slotId} attachment: ${key}`);
      bonesInstance.updateSlotAttachments();
      forceUpdate();
    };
    const slotReorder = () => {
      bonesInstance.updateSlotAttachments();
      forceUpdate();
    };

    // === Lifecycle ===
    onMounted(async () => {
      renderFn.value = await loadHtmlPage('./allEditor.html');
      await nextTick();
      await drawGlCanvas();

      if (!initGlAlready.value) {
        lastLoadedImageType.value = 'png';
        clearTexture(selectedLayers);
        await pngLoadTexture('./png3.png');
        initGlAlready.value = true;
        if (!texture.value) await pngRender(); else await pngRenderAgain();
      } else {
        await restoreWebGLResources(gl.value);
      }

      await bindGl(selectedLayers);
      showLayers.value = glsInstance.layers;

      // 🔥 Dynamic Render Passes
      const renderPassWrapper = () => {
        renderGridOnly(gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices);

        renderWeightPaint(
          gl.value,
          weightPaintProgram.value,
          selectedGroups.value[0],
          glsInstance.layers[currentChosedLayer.value],
          isWeightPaintMode.value
        );

        renderMeshSkeleton2(gl.value, skeletonProgram.value, meshSkeleton, bonesInstance, mousePressed, activeTool, wholeImageWidth.value, wholeImageHeight.value);
        renderOutBoundary(gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices);
      };

      if (activeTool.value === 'bone-animate') {
        bonesInstance.updatePoseMesh(gl.value);
      }

      setCurrentJobName('edit');

      // 🔥 [修正] 使用 selectedLayers (Ref 本身)
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers, [renderPassWrapper], "edit");
    });

    onUnmounted(() => {
      const canvas = document.getElementById('webgl2');
      if (canvas) {
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('mouseleave', handleMouseUp);
        canvas.removeEventListener('wheel', handleWheel);
      }
      if (gl.value) {
        gl.value = null;
        setCurrentJobName("exit");
      }
    });

    return () => renderFn.value ? renderFn.value({
      counter, v, triggerRefresh, activeTool, selectTool, bindingBoneWeight, skeletons, selectedItem,
      showLayers, selectedLayers, chosenLayers, selectedGroups, lastSelectedBone, currentChosedLayer,
      vertexGroupInfo, weightValue,

      editState,
      startEdit,
      confirmEdit,
      toggleSelect: handleGroupClick,

      onAdd, onRemove, onAssign, onSelect, setWeight,
      timeline2, timelineList, selectedTimelineId, choseTimelineId, currentTimeline, renameTimeline,
      addTimeline, removeTimeline, addKeyframe, removeKeyframe,

      handlePSDUpload,
      psdImage,
      firstImage,
      onLayerCheckChange, // 控制勾勾
      selectLayer,
      playAnimation, isPlaying,
      exportSkeletonToSpineJson: handleExportSpine,
      saveSpineJson, timelineLength, playheadPosition,
      selectTimeline, expandedNodes, toggleNode, handleNameClick, toggleLayerSelection,
      onLayerCheckChange, testCountQQ, startResize, layoutState,
      slotVisibleChange, slotAttachmentChange, slotReorder, layers: showLayers
    }) : h('div', 'Loading...');
  }
});