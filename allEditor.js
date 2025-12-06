// allEditor.js
import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, onUnmounted, h, nextTick, inject, computed, watch, reactive } = Vue;

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
  meshSkeleton, // ✨ 引入 meshSkeleton 以便搜尋骨頭
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
// 🌳 TreeItem 組件 (保持原樣)
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
      let items = ""; if(this.layers && Array.isArray(this.layers) && this.layers.length > 0) { items = this.layers.map((L, i) => `${i}: ${L.name?.value || L.name}`).join('\n'); } else { items = "無可用圖層"; }
      const pick = prompt(`選擇初始圖片 Index:\n${items}`, "0"); const idx = Number(pick); const hasValidLayer = !Number.isNaN(idx) && idx >= 0 && this.layers && this.layers[idx];
      const newSlot = { id: `slot_${Date.now()}`, name: name, boneId: this.node.id, visible: true, blendMode: 'normal', color: { r: 1, g: 1, b: 1, a: 1 }, attachmentKey: hasValidLayer ? 'default' : null, attachments: {} };
      if (hasValidLayer) { newSlot.attachments['default'] = { type: 'region', name: 'default', refId: idx, path: this.layers[idx].name.value || this.layers[idx].name, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 100, height: 100 }; }
      if (!this.node.slots) this.node.slots = []; this.node.slots.splice(this.node.slots.length, 0, newSlot); this.reorderDone();
    },
    appendAttachment(slot) {
      const key = prompt('新 Attachment Key：', `img_${Object.keys(slot.attachments).length + 1}`); if (!key || slot.attachments[key]) return;
      let items = ""; if(this.layers && Array.isArray(this.layers)) { items = this.layers.map((L, i) => `${i}: ${L.name?.value || L.name}`).join('\n'); }
      const pick = prompt(`選擇圖片 Index:\n${items}`); const idx = Number(pick); if (Number.isNaN(idx) || idx < 0 || !this.layers || !this.layers[idx]) return;
      const newAttachment = { type: 'region', name: key, refId: idx, path: this.layers[idx].name.value || this.layers[idx].name, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 100, height: 100 };
      slot.attachments = { ...slot.attachments, [key]: newAttachment }; this.changeAttachment(slot, key);
    },
    deleteSlot(idx) { if (!confirm(`確定刪除 Slot？`)) return; this.node.slots.splice(idx, 1); this.reorderDone(); },
    moveSlot(idx, dir) { const arr = this.node.slots; const newIdx = idx + dir; if (newIdx < 0 || newIdx >= arr.length) return; [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]; this.reorderDone(); },
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
    const firstImage = inject('firstImage', () => { });

    // === Local State ===
    const selectedVertex = ref(-1);
    const isCtrlPressed = ref(false);
    const testCountQQ = ref(0);
    const layoutState = reactive({ rightPanelWidth: 280, layersHeight: 200, isResizing: false });
    const layers = computed(() => glsInstance.layers || []);

    // ✨ 控制編輯狀態 (使用 Reactive 避免 Ref 丟失問題)
    const editState = reactive({
      editingGroup: null,
      editName: ""
    });
    
    // 控制是否繪製權重
    const isWeightPaintMode = ref(false);

    // === 核心功能修正 ===

    // 1. 本地切換選取
    const handleGroupClick = (name) => {
      console.log("Clicking Group:", name);
      toggleSelect(name);
      
      // 連動更新繪製模式
      if (selectedGroups.value.includes(name)) {
        isWeightPaintMode.value = true;
      } else {
        isWeightPaintMode.value = false;
      }
      forceUpdate();
    };

    // 2. 開始編輯名稱
    const startEdit = (name) => {
      console.log("Start editing group:", name);
      editState.editingGroup = name;
      editState.editName = name;
    };

    // 3. 確認編輯名稱 (🔥 關鍵修正：同步修改 Bone Name)
    const confirmEdit = (group) => {
      if (!group) return;
      const newName = editState.editName.trim();
      
      console.log(`Confirming edit for group ${group.name}, new name: ${newName}`);
      
      if (newName !== "" && newName !== group.name) {
        const oldName = group.name;
        
        // A. 更新 Vertex Group 的名稱
        group.name = newName;
        
        // B. 同步更新 Bone 的名稱 (如果存在同名骨頭)
        // 這樣 WebGL 渲染時才能透過新名字找到骨頭並計算變形
        if (meshSkeleton) {
            let targetBone = null;
            meshSkeleton.forEachBone(b => {
                if(b.name === oldName) targetBone = b;
            });
            
            if (targetBone) {
                targetBone.name = newName;
                console.log(`✅ 同步修改骨頭名稱: ${oldName} -> ${newName}`);
            } else {
                console.warn(`⚠️ 找不到對應名稱的骨頭: ${oldName}，變形可能會失效`);
            }
        }
        
        // C. 如果這個 Group 是選中狀態，更新選取清單
        if (selectedGroups.value.includes(oldName)) {
           selectedGroups.value = [newName];
        }

        // D. 強制刷新畫面
        triggerRefresh(); 
      }
      
      // 退出編輯
      editState.editingGroup = null;
      editState.editName = "";
    };

    // === Mouse Event Handlers ===
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
            if(!currentLayer) return;
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
    const onLayerCheckChange = (index, event) => { /* ... Check logic ... */ };
    const slotVisibleChange = ({slotId, visible}) => {
       console.log(`Slot ${slotId} visible: ${visible}`);
       bonesInstance.updateSlotAttachments();
       forceUpdate();
    };
    const slotAttachmentChange = ({slotId, key}) => {
       console.log(`Slot ${slotId} attachment: ${key}`);
       bonesInstance.updateSlotAttachments();
       forceUpdate();
    };
    const slotReorder = () => {
       bonesInstance.updateSlotAttachments();
       forceUpdate();
    };
const isPlaying = ref(false); // 控制播放狀態
    let animationReqId = null;    // 用來取消 requestAnimationFrame

    const animationLoop = () => {
      if (!isPlaying.value) return;

      // 1. 移動時間軸 (這裡設定每次 +5，你可以改成由變數控制速度)
      playheadPosition.value += 5;

      // 2. 循環播放判斷
      if (playheadPosition.value > timelineLength.value) {
        playheadPosition.value = 0;
      }

      // 3. 更新骨架 Pose (根據當前時間)
      if (timeline2.value) {
        // 假設 timeline2 有 update 方法，傳入時間與骨架
        timeline2.value.update(playheadPosition.value, skeletons);
      }

      // 4. 更新 WebGL 畫面
      if (gl.value) {
        bonesInstance.updatePoseMesh(gl.value);     // 更新網格變形
        bonesInstance.updateSlotAttachments();      // 更新圖片切換
      }

      // 5. 強制 Vue 與 Canvas 刷新
      forceUpdate();

      // 6. 下一幀
      animationReqId = requestAnimationFrame(animationLoop);
    };

    const playAnimation = () => {
      if (isPlaying.value) {
        // 暫停
        isPlaying.value = false;
        if (animationReqId) cancelAnimationFrame(animationReqId);
        console.log("Animation Stopped");
      } else {
        // 播放
        isPlaying.value = true;
        animationLoop();
        console.log("Animation Started");
      }
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
        
        // 本地狀態與方法
        editState, // 🔥 修正：傳出 editState 物件
        startEdit, 
        confirmEdit,
        toggleSelect: handleGroupClick, 

        onAdd, onRemove, onAssign, onSelect, setWeight,
        timeline2, timelineList, selectedTimelineId, choseTimelineId, currentTimeline, renameTimeline,
        addTimeline, removeTimeline, addKeyframe, removeKeyframe, handlePSDUpload: () => {}, psdImage: () => {},
        playAnimation, exportSkeletonToSpineJson, saveSpineJson, timelineLength, playheadPosition,
        selectTimeline, expandedNodes, toggleNode, handleNameClick, toggleLayerSelection,
        firstImage, onLayerCheckChange, testCountQQ, startResize, layoutState,
        slotVisibleChange, slotAttachmentChange, slotReorder, layers: showLayers
    }) : h('div', 'Loading...');
  }
});