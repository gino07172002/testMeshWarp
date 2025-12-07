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

    // === Injections ===
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

    // UI Layout
    const layoutState = reactive({ rightPanelWidth: 300, layersHeight: 250, isResizing: false });
    const camera = reactive({ x: 0, y: 0, zoom: 1.0 });

    // Mouse Event State
    let isDragging = false;
    let localSelectedVertex = -1;
    let startPosX = 0; let startPosY = 0;
    let useMultiSelect = true;
    let dragStartX = 0; let dragStartY = 0;
    let selectedBoundaryIndex = -1;

    // === UI Helpers ===
    const onLayerCheckChange = (index, event) => {
      const isChecked = event.target.checked;
      if (isChecked) {
        if (!selectedLayers.value.includes(index)) selectedLayers.value.push(index);
      } else {
        const idx = selectedLayers.value.indexOf(index);
        if (idx > -1) selectedLayers.value.splice(idx, 1);
      }
      selectedLayers.value.sort((a, b) => a - b);
      forceUpdate();
    };

    const selectLayer = (index) => {
      console.log("MeshEditor: Switch editing layer to:", index);
      currentChosedLayer.value = index;
      if (!selectedLayers.value.includes(index)) {
         selectedLayers.value.push(index);
         selectedLayers.value.sort((a, b) => a - b);
      }
      selectedVertex.value = -1;
      forceUpdate();
    };

    // === Event Handlers ===
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
        }
        else if (activeTool.value === 'add-points') {
          if (e.button === 0) glsInstance.updateLayerVertices(gl.value, glsInstance.layers[currentChosedLayer.value], { add: [{ x: xNDC, y: yNDC }] });
        }
        else if (activeTool.value === 'edit-points') {
          if (e.button === 0) { selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]); isDragging = true; }
        }
        else if (activeTool.value === 'remove-points') {
          if (e.button === 0) {
            let vIdx = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
            if (vIdx !== -1) glsInstance.updateLayerVertices(gl.value, glsInstance.layers[currentChosedLayer.value], { delete: [vIdx] });
          }
        }
        else if (activeTool.value === 'link-points') {
          if (e.button === 0) { selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]); isDragging = true; }
        }
        else if (activeTool.value === 'delete-edge') {
          if (e.button === 0) selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
        }
        else if (activeTool.value === 'edit-boundary') {
          if (e.button === 0) {
            selectedBoundaryIndex = glsInstance.handleBoundaryInteraction(xNDC, yNDC, glsInstance.layers, currentChosedLayer);
            if (selectedBoundaryIndex !== -1) isDragging = true;
          }
        }
        else if (activeTool.value === 'bone-create') {
          if (e.button === 2) { bonesInstance.handleMeshBoneEditMouseDown(xNDC, yNDC); isDragging = true; }
          else { bonesInstance.handleMeshBoneCreateMouseDown(xNDC, yNDC, isShiftPressed.value); isDragging = true; }
        }
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

      if (!isDragging) {
        const isCreateMode = (activeTool.value === 'bone-create');
        bonesInstance.GetCloestBoneAsHoverBone(xNDC, yNDC, isCreateMode);
        if (activeTool.value === 'edit-boundary') mousePosition.value = glsInstance.updateMousePosition(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);
        return;
      }

      if (activeTool.value === 'grab-point' && isDragging) {
        bonesInstance.moveSelectedVertex(currentChosedLayer, useMultiSelect, localSelectedVertex, gl.value, xNDC, yNDC, dragStartX, dragStartY);
        dragStartX = xNDC; dragStartY = yNDC;
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
        if (e.buttons === 2) bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
        else bonesInstance.meshboneCreateMouseMove(xNDC, yNDC);
      }
      else if (activeTool.value === 'bone-animate') {
        bonesInstance.handleMeshBoneAnimateMouseDown(xNDC, yNDC);
        bonesInstance.updatePoseMesh(gl.value);
        forceUpdate();
      }
      else if (activeTool.value === 'edit-boundary') {
        if (selectedBoundaryIndex !== -1) glsInstance.updateBoundary(xNDC, yNDC, selectedBoundaryIndex, glsInstance.layers[currentChosedLayer.value], isShiftPressed.value);
      }
    };

    const handleMouseUp = (e) => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;
      const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, canvas.closest('.canvas-area'));
      mousePressed.value = null;

      if (activeTool.value === 'bone-create' && isDragging) {
        if (e.button === 2) bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
        else bonesInstance.MeshBoneCreate(xNDC, yNDC);
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
      isDragging = false;
      selectedVertex.value = -1;
      forceUpdate();
    };

    const handleWheel = (e) => {
      e.preventDefault();
      const zoomIntensity = 0.1;
      const direction = e.deltaY > 0 ? -1 : 1;
      const factor = 1 + (zoomIntensity * direction);
      const canvas = document.getElementById('webgl2');
      if (!canvas) return;
      const container = canvas.closest('.canvas-area') || canvas.parentElement;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const worldX = (mouseX - camera.x) / camera.zoom;
      const worldY = (mouseY - camera.y) / camera.zoom;
      const newZoom = Math.max(0.1, Math.min(5.0, camera.zoom * factor));
      camera.zoom = newZoom;
      camera.x = mouseX - worldX * newZoom;
      camera.y = mouseY - worldY * newZoom;
    };

    const handlePan = (e) => {
      if (e.button === 1) { 
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
    // 🛠️ Helper Functions
    // ==========================================

    const drawGlCanvas = async () => {
      const canvas = document.getElementById('webgl2');
      if (!canvas) { console.error("Canvas #webgl2 not found!"); return; }
      const webglContext = canvas.getContext('webgl2');
      if (gl.value) {
        gl.value.deleteProgram(program.value);
        gl.value.deleteProgram(colorProgram.value);
        gl.value.deleteProgram(skeletonProgram.value);
        gl.value.deleteProgram(weightPaintProgram.value);
        gl.value.deleteProgram(skinnedProgram.value);
        gl.value = null;
      }
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

    const addMesh = () => {
      console.log("Add Mesh Triggered");
      if (glsInstance.layers.length > 0 && currentChosedLayer.value !== null && currentChosedLayer.value < glsInstance.layers.length) {
        const sourceLayerIndex = currentChosedLayer.value;
        const sourceLayer = glsInstance.layers[sourceLayerIndex];
        const newLayerName = sourceLayer.name.value + "_Copy";
        const newLayer = glsInstance.addLayer(newLayerName);
        const newIndex = glsInstance.layers.length - 1;

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

        const { vbo, ebo, eboLines } = glsInstance.createWebGLBuffers(gl.value, newLayer.vertices.value, newLayer.indices.value, newLayer.linesIndices.value);
        newLayer.vbo = vbo; newLayer.ebo = ebo; newLayer.eboLines = eboLines;

        const refLayer = glsInstance.refLayers[newIndex];
        if (refLayer) {
          const { vbo: rvbo, ebo: rebo, eboLines: reboLines } = glsInstance.createWebGLBuffers(
            gl.value, newLayer.vertices.value, newLayer.indices.value, newLayer.linesIndices.value
          );
          refLayer.vbo = rvbo; refLayer.ebo = rebo; refLayer.eboLines = reboLines;
          refLayer.transformParams = JSON.parse(JSON.stringify(newLayer.transformParams));
          refLayer.vertices.value = [...newLayer.vertices.value];
          // 🔥 [修正] 補上 indices 和 linesIndices，確保 render 時能畫出來
          refLayer.indices.value = [...newLayer.indices.value];
          refLayer.linesIndices.value = [...newLayer.linesIndices.value];
        }

        if (texture.value && texture.value[sourceLayerIndex]) texture.value.push(texture.value[sourceLayerIndex]);

        const newMeshObj = new Mesh2D(newLayerName);
        newMeshObj.image = loadedImage.value || sourceLayer.image;
        newMeshObj.vertices = [...newLayer.vertices.value];
        newMeshObj.indices = [...newLayer.indices.value];
        newMeshObj.linesIndices = [...newLayer.linesIndices.value];
        meshs.value.push(newMeshObj);

        selectLayer(newIndex);
      } else {
        console.warn("未選中圖層，無法複製 Mesh");
      }
    };

    const fitLayerBoundary = () => { if (currentChosedLayer.value !== null) fitTransformToVertices(glsInstance.layers[currentChosedLayer.value]); }
    const fitLayerBoundary2 = () => { if (currentChosedLayer.value !== null) fitTransformToVertices2(glsInstance.layers[currentChosedLayer.value]); }
    const toggleMeshSelection = (index) => { if (chosenMesh.value.includes(index)) chosenMesh.value = chosenMesh.value.filter(i => i !== index); else chosenMesh.value.push(index); }
    const startResize = (type, event) => {
      layoutState.isResizing = true;
      const startX = event.clientX; const startY = event.clientY;
      const startWidth = layoutState.rightPanelWidth; const startHeight = layoutState.layersHeight;
      const onMouseMove = (moveEvent) => {
        if (type === 'right-panel') { const deltaX = startX - moveEvent.clientX; layoutState.rightPanelWidth = Math.max(150, Math.min(600, startWidth + deltaX)); }
        else if (type === 'layer-height') { const deltaY = moveEvent.clientY - startY; layoutState.layersHeight = Math.max(100, Math.min(500, startHeight + deltaY)); }
      };
      const onMouseUp = () => { layoutState.isResizing = false; window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
      window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp);
    };

    onMounted(async () => {
      renderFn.value = await loadHtmlPage('./meshEditor.html');
      await nextTick();
      await drawGlCanvas();

      if (!initGlAlready.value) {
        lastLoadedImageType.value = 'png';
        clearTexture(selectedLayers);
        await pngLoadTexture('./png3.png');
        initGlAlready.value = true;
        if (!texture.value) await pngRender(); else await pngRenderAgain();
        showLayers.value = glsInstance.layers;
        if(glsInstance.layers.length > 0) selectLayer(0);
      } else {
        console.log("🔄 Restoring GL Resources...");
        await restoreWebGLResources(gl.value);
        if(selectedLayers.value.length === 0 && glsInstance.layers.length > 0) selectLayer(0);
      }

      await bindGl(selectedLayers);
      showLayers.value = glsInstance.layers;

      // 建立半透明參考層 (Ref Layer) Pass
      const beforePasses = [
        makeRenderPass(render, gl.value, program.value, glsInstance.refLayers, selectedLayers)
      ];

      const passes = [
        makeRenderPass(renderGridOnly, gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices),
        makeRenderPass(renderWeightPaint, gl.value, weightPaintProgram.value, selectedGroups.value[0], glsInstance.layers[currentChosedLayer.value]),
        makeRenderPass(renderOutBoundary, gl.value, colorProgram.value, glsInstance.layers, glsInstance.getLayerSize(), currentChosedLayer, selectedVertices),
        makeRenderPass(renderMeshSkeleton2, gl.value, skeletonProgram.value, meshSkeleton, bonesInstance, mousePressed, activeTool,wholeImageWidth.value,wholeImageHeight.value)
      ];

      if (activeTool.value === 'bone-animate') bonesInstance.updatePoseMesh(gl.value);

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
      counter, v, triggerRefresh, activeTool, selectTool, showLayers, selectedLayers, chosenLayers,
      currentChosedLayer, selectLayer, onLayerCheckChange,
      toggleLayerSelection, addMesh, meshs, chosenMesh, toggleMeshSelection, selectedMesh,
      fitLayerBoundary, fitLayerBoundary2, mousePosition, layoutState, camera, handleWheel, handlePan, startResize
    }) : h('div', 'Loading Editor...');
  }
});