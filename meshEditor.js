// meshEditor.js
import { useCounterStore, Mesh2D } from './mesh.js';
const { defineComponent, ref, onMounted, onUnmounted, h, nextTick, inject, computed, reactive } = Vue;

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
  meshSkeleton,
  skeletons,
  bonesInstance,
  selectedVertices
} from './useBone.js';

import glsInstance from './useWebGL.js';

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
  renderMeshSkeleton,
  renderMeshSkeleton2,
  renderWeightPaint,
  makeRenderPass,
  bindGl,
  clearTexture,
  pngLoadTexture,
  getClosestVertex,
  renderOutBoundary,
  loadedImage,
  fitTransformToVertices,
  fitTransformToVertices2,
  restoreWebGLResources,
  getMouseLocalPos
} from './useWebGL.js';

export const meshEditor = defineComponent({
  name: 'Editor',
  setup() {
    const counter = useCounterStore();
    const renderFn = ref(null);

    // === Injections (來自 app.js 的 Provide) ===
    const activeTool = inject('activeTool', ref('grab-point'));
    const showLayers = inject('showLayers', ref([]));
    const selectTool = inject('selectTool', () => { });
    const currentChosedLayer = inject('currentChosedLayer', ref(null));
    const chosenLayers = inject('chosenLayers', ref([]));
    const selectedGroups = inject('selectedGroups', ref([]));
    const toggleLayerSelection = inject('toggleLayerSelection', () => { });

    // === Local State ===
    const mousePosition = ref(null);
    const selectedMesh = ref(null);
    const chosenMesh = ref([]);
    const selectedVertex = ref(-1);
    const isCtrlPressed = ref(false);

    // UI Layout State
    const layoutState = reactive({
      rightPanelWidth: 300,
      layersHeight: 250,
      isResizing: false
    });

    // Camera / View State
    const camera = reactive({ x: 0, y: 0, zoom: 1.0 });

    // === Mouse Event State Variables ===
    let isDragging = false;
    let localSelectedVertex = -1;
    let startPosX = 0;
    let startPosY = 0;
    let useMultiSelect = true; // 預設開啟多選邏輯
    let dragStartX = 0;
    let dragStartY = 0;
    let selectedBoundaryIndex = -1;

    // ==========================================
    // 🖱️ Event Handlers (Defined in Setup Scope)
    // ==========================================

    const handleMouseDown = (e) => {
      // 確保在 canvas 範圍內才觸發 (雖然綁定在 canvas 上，但為了保險)
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;

      mousePressed.value = e.button;
      const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, canvas.closest('.canvas-area')); // 假設有 .canvas-area容器
      const { x: rawX, y: rawY } = getRawXY(e, canvas, canvas.closest('.canvas-area'));

      startPosX = xNDC;
      startPosY = yNDC;

      // 左鍵 (0) 或 右鍵 (2)
      if (e.button === 0 || e.button === 2) {

        // --- Tool: Grab Point ---
        if (activeTool.value === 'grab-point') {
          const currentLayer = glsInstance.layers[currentChosedLayer.value];
          if (!currentLayer) return;

          // ✨ 使用重構後的 Local 座標轉換，確保旋轉後也能準確點選
          const { x: localMouseX, y: localMouseY } = getMouseLocalPos(xNDC, yNDC, currentLayer);
          const vertices = currentLayer.vertices.value;

          if (!useMultiSelect) {
            // 單點模式
            let minDist = Infinity;
            localSelectedVertex = -1;
            const thresholdSq = 0.05 * 0.05;

            for (let i = 0; i < vertices.length; i += 4) {
              const dx = vertices[i] - localMouseX;
              const dy = vertices[i + 1] - localMouseY;
              const distSq = dx * dx + dy * dy;
              if (distSq < minDist) {
                minDist = distSq;
                localSelectedVertex = i / 4;
              }
            }

            if (minDist < thresholdSq) {
              isDragging = true;
              selectedVertex.value = localSelectedVertex;
            }
          } else {
            // 群組模式 (檢查是否點擊在已選取的點上)
            let hitVertex = -1;
            // 這裡依然需要檢查是否點中任何一個已選點，為了開始拖曳
            // 注意：這裡簡化判斷，若需要精確點選特定點可遍歷 selectedVertices.value
            // 為了效能，這裡假設 bonesInstance 內部有處理選取狀態，這裡只負責啟動拖曳
            // 如果要檢查點擊位置：
            const thresholdSq = 0.05 * 0.05;
            // 引用外部 selectedVertices (從 useBone 或 globalVars)
            // 假設 selectedVertices 在 bonesInstance 內管理，或者透過 globalVars 引入
            // 這裡先使用 bonesInstance 的邏輯
            // 修正：應該從 globalVars 或 useBone 引入 selectedVertices
            // 假設在 useBone.js 裡有 export selectedVertices
            // (上方已 import { selectedVertices } from './useBone.js')

            for (let idx of selectedVertices.value) {
              const vx = vertices[idx * 4];
              const vy = vertices[idx * 4 + 1];
              const dx = vx - localMouseX;
              const dy = vy - localMouseY;
              if ((dx * dx + dy * dy) < thresholdSq) {
                hitVertex = idx;
                break;
              }
            }

            if (hitVertex !== -1) {
              isDragging = true;
              dragStartX = xNDC; // 記錄 NDC 用於後續計算 delta
              dragStartY = yNDC;
            }
          }
        }
        // --- Tool: Select Points (Box Select) ---
        else if (activeTool.value === 'select-points') {
          bonesInstance.handleSelectPointsMouseDown(xNDC, yNDC, rawX, rawY);
          isDragging = true;
        }
        // --- Tool: Add Points ---
        else if (activeTool.value === 'add-points') {
          if (e.button === 0) {
            glsInstance.updateLayerVertices(gl.value, glsInstance.layers[currentChosedLayer.value], { add: [{ x: xNDC, y: yNDC }] });
          }
        }
        // --- Tool: Edit Points ---
        else if (activeTool.value === 'edit-points') {
          if (e.button === 0) {
            selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
            isDragging = true;
          }
        }
        // --- Tool: Remove Points ---
        else if (activeTool.value === 'remove-points') {
          if (e.button === 0) {
            let vIdx = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
            if (vIdx !== -1) {
              glsInstance.updateLayerVertices(gl.value, glsInstance.layers[currentChosedLayer.value], { delete: [vIdx] });
            }
          }
        }
        // --- Tool: Link Points ---
        else if (activeTool.value === 'link-points') {
          if (e.button === 0) {
            selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
            isDragging = true;
          }
        }
        // --- Tool: Delete Edge ---
        else if (activeTool.value === 'delete-edge') {
          if (e.button === 0) {
            selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
          }
        }
        // --- Tool: Edit Boundary (Green Box) ---
        else if (activeTool.value === 'edit-boundary') {
          if (e.button === 0) {
            selectedBoundaryIndex = glsInstance.handleBoundaryInteraction(
              xNDC, yNDC, glsInstance.layers, currentChosedLayer
            );
            if (selectedBoundaryIndex !== -1) isDragging = true;
          }
        }
        // --- Tool: Bone Create ---
        else if (activeTool.value === 'bone-create') {
          if (e.button === 2) { // Right click edit
            bonesInstance.handleMeshBoneEditMouseDown(xNDC, yNDC);
            isDragging = true;
          } else {
            bonesInstance.handleMeshBoneCreateMouseDown(xNDC, yNDC, isShiftPressed.value);
            isDragging = true;
          }
        }
        // --- Tool: Bone Animate ---
        else if (activeTool.value === 'bone-animate') {
          bonesInstance.GetCloestBoneAsSelectBone(xNDC, yNDC, false);
          isDragging = true;
        }
      }
    };

    const handleMouseMove = (e) => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;

      const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, canvas.closest('.canvas-area'));
      const { x: rawX, y: rawY } = getRawXY(e, canvas, canvas.closest('.canvas-area'));

      // Hover 狀態處理 (非拖曳時)
      if (!isDragging) {
        const isCreateMode = (activeTool.value === 'bone-create');
        bonesInstance.GetCloestBoneAsHoverBone(xNDC, yNDC, isCreateMode);

        if (activeTool.value === 'edit-points') {
          // Preview logic if needed
        } else if (activeTool.value === 'edit-boundary') {
          mousePosition.value = glsInstance.updateMousePosition(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
        }
        return;
      }

      // Dragging 狀態處理
      if (activeTool.value === 'grab-point' && isDragging) {
        bonesInstance.moveSelectedVertex(currentChosedLayer, useMultiSelect, localSelectedVertex, gl.value, xNDC, yNDC, dragStartX, dragStartY);
        dragStartX = xNDC;
        dragStartY = yNDC;
        forceUpdate();
      }
      else if (activeTool.value === 'select-points') {
        bonesInstance.handleSelectPointsMouseMove(xNDC, yNDC, rawX, rawY);
      }
      else if (activeTool.value === 'edit-points') {
        if (selectedVertex.value !== -1) {
          glsInstance.updateLayerVertices(gl.value, glsInstance.layers[currentChosedLayer.value], { update: [{ index: selectedVertex.value, x: xNDC, y: yNDC }] });
          forceUpdate();
        }
      }
      else if (activeTool.value === 'bone-create') {
        if (e.buttons === 2) {
          bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
        } else {
          bonesInstance.meshboneCreateMouseMove(xNDC, yNDC);
        }
      }
      else if (activeTool.value === 'bone-animate') {
        bonesInstance.handleMeshBoneAnimateMouseDown(xNDC, yNDC); // 注意：這裡可能命名為 MouseMove 比較好，但沿用原邏輯
        bonesInstance.updatePoseMesh(gl.value);
        forceUpdate();
      }
      else if (activeTool.value === 'edit-boundary') {
        if (selectedBoundaryIndex !== -1) {
          glsInstance.updateBoundary(xNDC, yNDC, selectedBoundaryIndex, glsInstance.layers[currentChosedLayer.value], isShiftPressed.value);
        }
      }
    };

    const handleMouseUp = (e) => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;
      const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, canvas.closest('.canvas-area'));
      mousePressed.value = null; // Reset mouse pressed state

      if (activeTool.value === 'bone-create' && isDragging) {
        if (e.button === 2) {
          bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
        } else {
          bonesInstance.MeshBoneCreate(xNDC, yNDC);
        }
      }
      else if (activeTool.value === 'select-points' && isDragging) {
        bonesInstance.handleSelectPointsMouseUp(xNDC, yNDC, currentChosedLayer.value, isShiftPressed.value, isCtrlPressed.value);
      }
      else if (activeTool.value === 'link-points') {
        if (e.button === 0) {
          let vertex2 = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
          if (vertex2 !== -1 && selectedVertex.value !== -1 && vertex2 !== selectedVertex.value) {
            glsInstance.updateLayerVertices(gl.value, glsInstance.layers[currentChosedLayer.value], { addEdge: [{ v1: selectedVertex.value, v2: vertex2 }] });
          }
        }
      }
      else if (activeTool.value === 'delete-edge') {
        if (e.button === 0) {
          let vertex2 = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
          if (vertex2 !== -1 && selectedVertex.value !== -1 && vertex2 !== selectedVertex.value) {
            glsInstance.updateLayerVertices(gl.value, glsInstance.layers[currentChosedLayer.value], { deleteEdge: [{ v1: selectedVertex.value, v2: vertex2 }] });
          }
        }
      }
      else if (activeTool.value === 'edit-boundary') {
        selectedBoundaryIndex = -1;
      }

      // Cleanup
      isDragging = false;
      selectedVertex.value = -1;
      forceUpdate();
    };

const handleWheel = (e) => {
      e.preventDefault();

      // 1. 設定縮放參數
      const zoomIntensity = 0.1;
      const direction = e.deltaY > 0 ? -1 : 1; // 滾輪向下縮小，向上放大
      const factor = 1 + (zoomIntensity * direction);

      // 2. 取得 Canvas 容器資訊
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;
      
      // 嘗試抓取 .canvas-area 或父層容器
      const container = canvas.closest('.canvas-area') || canvas.parentElement;
      const rect = container.getBoundingClientRect();

      // 3. 計算滑鼠相對於容器左上角的像素位置
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 4. 計算縮放前的「世界座標」(World Space)
      // 原理: (Mouse - Pan) / Zoom = World
      const worldX = (mouseX - camera.x) / camera.zoom;
      const worldY = (mouseY - camera.y) / camera.zoom;

      // 5. 計算新的 Zoom 值 (限制在 0.1 ~ 5.0 倍之間)
      const newZoom = Math.max(0.1, Math.min(5.0, camera.zoom * factor));

      // 6. 更新相機狀態
      camera.zoom = newZoom;

      // 7. 補償位移 (Pan)，讓縮放以滑鼠游標為中心
      // 新的 Pan = Mouse - (World * 新的 Zoom)
      camera.x = mouseX - worldX * newZoom;
      camera.y = mouseY - worldY * newZoom;

      // console.log(`Zoom: ${camera.zoom.toFixed(2)}, Pan: ${camera.x.toFixed(0)}, ${camera.y.toFixed(0)}`);
    };

    // ==========================================
    // 🛠️ Helper Functions
    // ==========================================

    const drawGlCanvas = async () => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) {
        console.error("Canvas #webgl2 not found!");
        return;
      }
      const webglContext = canvas.getContext('webgl2');

      if (gl.value) {
        // 清理舊 Program 以防 Context Lost
        gl.value.deleteProgram(program.value);
        gl.value.deleteProgram(colorProgram.value);
        gl.value.deleteProgram(skeletonProgram.value);
        gl.value.deleteProgram(weightPaintProgram.value);
        gl.value.deleteProgram(skinnedProgram.value);
        gl.value = null;
      }

      gl.value = webglContext;

      // 綁定事件 (使用 Setup 中定義的函數，確保唯一性)
      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('mouseleave', handleMouseUp); // 離開畫布視為放開
      canvas.addEventListener('wheel', handleWheel);

      // 建立 Shader Programs
      program.value = glsInstance.createProgram(gl.value, shaders.vertex, shaders.fragment);
      colorProgram.value = glsInstance.createProgram(gl.value, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = glsInstance.createProgram(gl.value, shaders.skeletonVertex, shaders.skeletonFragment);
      weightPaintProgram.value = glsInstance.createProgram(gl.value, shaders.weightPaintVertex, shaders.weightPaintFragment);
      skinnedProgram.value = glsInstance.createProgram(gl.value, shaders.skinnedVertex, shaders.skinnedFragment);
    };

    const addMesh = () => {
      console.log("Add Mesh Triggered");
      if (glsInstance.layers.length > 0 && currentChosedLayer.value !== null && currentChosedLayer.value < glsInstance.layers.length) {
        const sourceLayerIndex = currentChosedLayer.value;
        const sourceLayer = glsInstance.layers[sourceLayerIndex];

        const newLayerName = sourceLayer.name.value + "_Copy";
        const newLayer = glsInstance.addLayer(newLayerName);
        const newIndex = glsInstance.layers.length - 1;

        // 複製屬性
        newLayer.vertices.value = [...sourceLayer.vertices.value];
        newLayer.indices.value = [...sourceLayer.indices.value];
        newLayer.linesIndices.value = [...sourceLayer.linesIndices.value];
        newLayer.poseVertices.value = [...sourceLayer.poseVertices.value];
        if (sourceLayer.edges) newLayer.edges = new Set(sourceLayer.edges);
        if (sourceLayer.originalTriangles) newLayer.originalTriangles = new Set(sourceLayer.originalTriangles);
        if (sourceLayer.transformParams) newLayer.transformParams = JSON.parse(JSON.stringify(sourceLayer.transformParams));
        if (sourceLayer.transformParams2) newLayer.transformParams2 = JSON.parse(JSON.stringify(sourceLayer.transformParams2));
        newLayer.image = sourceLayer.image;
        newLayer.width = sourceLayer.width;
        newLayer.height = sourceLayer.height;

        // 建立 Buffer
        const { vbo, ebo, eboLines } = glsInstance.createWebGLBuffers(
          gl.value, newLayer.vertices.value, newLayer.indices.value, newLayer.linesIndices.value
        );
        newLayer.vbo = vbo; newLayer.ebo = ebo; newLayer.eboLines = eboLines;

        // 處理 Ref Layer
        const refLayer = glsInstance.refLayers[newIndex];
        if (refLayer) {
          const { vbo: rvbo, ebo: rebo, eboLines: reboLines } = glsInstance.createWebGLBuffers(
            gl.value, newLayer.vertices.value, newLayer.indices.value, newLayer.linesIndices.value
          );
          refLayer.vbo = rvbo; refLayer.ebo = rebo; refLayer.eboLines = reboLines;
          refLayer.transformParams = JSON.parse(JSON.stringify(newLayer.transformParams));
          refLayer.vertices.value = [...newLayer.vertices.value];
        }

        // 複製 Texture 參照
        if (texture.value && texture.value[sourceLayerIndex]) {
          texture.value.push(texture.value[sourceLayerIndex]);
        }

        // 建立 Mesh Object
        const newMeshObj = new Mesh2D(newLayerName);
        newMeshObj.image = loadedImage.value || sourceLayer.image;
        newMeshObj.vertices = [...newLayer.vertices.value];
        newMeshObj.indices = [...newLayer.indices.value];
        newMeshObj.linesIndices = [...newLayer.linesIndices.value];
        meshs.value.push(newMeshObj);

        // 自動選中
        toggleLayerSelection(newIndex);
        chosenLayers.value = [newIndex]; // 單選
        forceUpdate();
      } else {
        console.warn("未選中圖層，無法複製 Mesh");
      }
    };

    const fitLayerBoundary = () => {
      if (currentChosedLayer.value !== null) fitTransformToVertices(glsInstance.layers[currentChosedLayer.value]);
    }
    const fitLayerBoundary2 = () => {
      if (currentChosedLayer.value !== null) fitTransformToVertices2(glsInstance.layers[currentChosedLayer.value]);
    }
    const toggleMeshSelection = (index) => {
      if (chosenMesh.value.includes(index)) chosenMesh.value = chosenMesh.value.filter(i => i !== index);
      else chosenMesh.value.push(index);
    }

    const startResize = (type, event) => {
      layoutState.isResizing = true;
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = layoutState.rightPanelWidth;
      const startHeight = layoutState.layersHeight;

      const onMouseMove = (moveEvent) => {
        if (type === 'right-panel') {
          const deltaX = startX - moveEvent.clientX;
          layoutState.rightPanelWidth = Math.max(150, Math.min(600, startWidth + deltaX));
        } else if (type === 'layer-height') {
          const deltaY = moveEvent.clientY - startY;
          layoutState.layersHeight = Math.max(100, Math.min(500, startHeight + deltaY));
        }
      };

      const onMouseUp = () => {
        layoutState.isResizing = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    const handlePan = (e) => {
      if (e.button === 1) { // Middle click
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const startCamX = camera.x, startCamY = camera.y;

        const onMouseMove = (ev) => {
          camera.x = startCamX + (ev.clientX - startX);
          camera.y = startCamY + (ev.clientY - startY);
        };
        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    };

    // ==========================================
    // 🚀 Lifecycle
    // ==========================================

    onMounted(async () => {
      renderFn.value = await loadHtmlPage('./meshEditor.html');
      await nextTick();
      await drawGlCanvas();

      if (!initGlAlready.value) {
        lastLoadedImageType.value = 'png';
        clearTexture(selectedLayers);
        await pngLoadTexture('./png3.png');
        initGlAlready.value = true;
        // 初始渲染邏輯 (模擬 initAnything)
        if (!texture.value) await pngRender();
        else await pngRenderAgain();
        showLayers.value = glsInstance.layers;
      } else {
        console.log("🔄 Restoring GL Resources...");
        await restoreWebGLResources(gl.value);
      }

      await bindGl(selectedLayers);
      showLayers.value = glsInstance.layers;

      // Render Passes Setup
      const beforePasses = [
        makeRenderPass(render, gl.value, program.value, glsInstance.refLayers, selectedLayers)
      ];

      const passes = [
        makeRenderPass(renderGridOnly, gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices),
        makeRenderPass(renderWeightPaint, gl.value, weightPaintProgram.value, selectedGroups.value[0], glsInstance.layers[currentChosedLayer.value]),
        makeRenderPass(renderOutBoundary, gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices),
        makeRenderPass(renderMeshSkeleton2, gl.value, skeletonProgram.value, meshSkeleton, bonesInstance, mousePressed, activeTool,wholeImageWidth.value,wholeImageHeight.value)
      ];

      if (activeTool.value === 'bone-animate') {
        bonesInstance.updatePoseMesh(gl.value);
      }

      setCurrentJobName('edit');
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers, passes, "edit", beforePasses);
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
        gl.value.deleteProgram(program.value);
        gl.value.deleteProgram(colorProgram.value);
        gl.value.deleteProgram(skeletonProgram.value);
        gl.value = null;
        setCurrentJobName("exit");
      }
    });

    return () => renderFn.value ? renderFn.value({
      counter,
      v,
      triggerRefresh,
      activeTool,
      selectTool,
      showLayers,
      selectedLayers,
      chosenLayers,
      toggleLayerSelection,
      addMesh,
      meshs,
      chosenMesh,
      toggleMeshSelection,
      selectedMesh,
      fitLayerBoundary,
      fitLayerBoundary2,
      mousePosition,
      layoutState,
      camera,
      handleWheel,
      handlePan,
      startResize
    }) : h('div', 'Loading Editor...');
  }
});