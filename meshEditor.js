//Editor.js
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
  meshs
} from './globalVars.js'  // 引入全局變數
import {
  //initBone,
  boneParents,
  meshSkeleton,
  skeletons,
  lastSelectedBone,
  selectedVertices,
  bonesInstance
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
  psdRenderAgain,
  pngRenderAgain,
  renderMeshSkeleton,
  renderWeightPaint,
  makeRenderPass,
  bindGl,
  clearTexture,
  pngLoadTexture,
  layerForTextureWebgl,
  getClosestVertex,
  renderOutBoundary,
  loadedImage,
  fitTransformToVertices,
  fitTransformToVertices2,
  restoreWebGLResources
} from './useWebGL.js';


//load meshEditor.html at beginning
export const meshEditor = defineComponent({
  name: 'Editor',
  setup() {
    const counter = useCounterStore();
    const renderFn = ref(null);
    const activeTool = inject('activeTool', ref('grab-point'));
    const showLayers = inject('showLayers', ref([]));
    const selectTool = inject('selectTool', (tool) => { console.warn('selectTool not provided', tool); });
    const currentChosedLayer = inject('currentChosedLayer', ref(null));
    const chosenLayers = inject('chosenLayers', ref([]));
    const selectedGroups = inject('selectedGroups', ref([]));
    const toggleLayerSelection = inject('toggleLayerSelection', () => { console.log('toggleLayerSelection not provided'); });

    const mousePosition = ref(null);
    const selectedMesh = ref(null);

    const chosenMesh = ref([]);

    const selectedVertex = ref(-1);

    const isCtrlPressed = ref(false);
    const drawGlCanvas = async () => {
      const canvas = document.getElementById('webgl2');
      const webglContext = canvas.getContext('webgl2');
      if (!canvas) {
        console.error("Canvas not found!");
        return;
      }
      if (gl.value) {
        gl.value.deleteProgram(program.value);
        gl.value.deleteProgram(colorProgram.value);
        gl.value.deleteProgram(skeletonProgram.value);
        gl.value = null;
      }
      gl.value = webglContext;
      setupCanvasEvents(canvas, gl.value);

      // 创建着色器程序
      program.value = glsInstance.createProgram(gl.value, shaders.vertex, shaders.fragment);
      colorProgram.value = glsInstance.createProgram(gl.value, shaders.colorVertex, shaders.colorFragment);
      skeletonProgram.value = glsInstance.createProgram(gl.value, shaders.skeletonVertex, shaders.skeletonFragment);
      weightPaintProgram.value = glsInstance.createProgram(gl.value, shaders.weightPaintVertex, shaders.weightPaintFragment);
      skinnedProgram.value = glsInstance.createProgram(gl.value, shaders.skinnedVertex, shaders.skinnedFragment);

    };
    const setupCanvasEvents = (canvas, gl, container) => {
      let isDragging = false;
      let alreadySelect = false;
      let localSelectedVertex = -1;
      let startPosX = 0;
      let startPosY = 0;
      let useMultiSelect = true;
      let dragStartX = 0, dragStartY = 0; // 記錄滑鼠起始點
      let selectedBoundaryIndex = -1;

      const handleMouseDown = (e) => {
        mousePressed.value = e.button;
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);
        startPosX = xNDC;
        startPosY = yNDC;
        let vertexIndex = -1;
        if (e.button === 0 || e.button === 2) {
          if (activeTool.value === 'grab-point') {

            if (!useMultiSelect) {
              // ===== 單點選取模式 =====
              let minDist = Infinity;
              localSelectedVertex = -1;

              const vertices = glsInstance.layers[currentChosedLayer.value].vertices.value;
              for (let i = 0; i < vertices.length; i += 4) {
                const dx = vertices[i] - xNDC;
                const dy = vertices[i + 1] - yNDC;
                const dist = dx * dx + dy * dy;
                if (dist < minDist) {
                  minDist = dist;
                  localSelectedVertex = i / 4;
                }
              }

              if (minDist < 0.02) {
                isDragging = true;
                selectedVertex.value = localSelectedVertex; // 單點記錄
              }

            } else {
              // ===== 多點群組模式 =====
              // 檢查點擊是否落在 selectedVertices 裡的某一個頂點
              let hitVertex = -1;
              const vertices = glsInstance.layers[currentChosedLayer.value].vertices.value;

              for (let idx of selectedVertices.value) {
                const vx = vertices[idx * 4];
                const vy = vertices[idx * 4 + 1];
                const dx = vx - xNDC;
                const dy = vy - yNDC;
                const dist = dx * dx + dy * dy;
                if (dist < 0.02) {
                  hitVertex = idx;
                  break;
                }
              }
              console.log(" hitVertex : ", hitVertex);

              if (hitVertex !== -1) {
                isDragging = true;
                dragStartX = xNDC;
                dragStartY = yNDC;
              }
            }


          } else if (activeTool.value === 'select-points') {
            bonesInstance.handleSelectPointsMouseDown(xNDC, yNDC, e.button === 0, isShiftPressed.value);
            isDragging = true;

          }

          else if (activeTool.value === 'add-points') {
            if (e.button === 2) {

            }
            else {
              console.log(" hi I should add point at : ", xNDC, " , ", yNDC);
              glsInstance.updateLayerVertices(gl, glsInstance.layers[currentChosedLayer.value], { add: [{ x: xNDC, y: yNDC }] });

            }
          }
          else if (activeTool.value === 'edit-points') {


            if (e.button === 2) {

            }
            else {
              console.log(" hi I should edit point at : ", xNDC, " , ", yNDC);
              selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value].vertices.value);
              isDragging = true;
            }
          }

          else if (activeTool.value === 'remove-points') {
            if (e.button === 2) {

            }

            else {
              console.log(" hi I should edit point at : ", xNDC, " , ", yNDC);

              let vertexIndex = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value].vertices.value);
              isDragging = true;
              console.log(" remove vertex index : ", vertexIndex);
              if (vertexIndex !== -1)
                glsInstance.updateLayerVertices(gl, glsInstance.layers[currentChosedLayer.value], { delete: [vertexIndex] });
            }
          }
          else if (activeTool.value === 'link-points') {
            if (e.button === 0) {

              selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value].vertices.value);
              console.log("link point select first vertex at  ", selectedVertex.value);
              isDragging = true;
            }
          }
          else if (activeTool.value === 'delete-edge') {
            if (e.button === 0) {

              selectedVertex.value = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value].vertices.value);
              console.log("delete edge  select first vertex at  ", selectedVertex.value);

            }
          }
          else if (activeTool.value === 'edit-boundary') {
            if (e.button === 0) {
              console.log("doing boundary interact");

              selectedBoundaryIndex = glsInstance.handleBoundaryInteraction(
                xNDC,
                yNDC,
                glsInstance.layers,
                currentChosedLayer
              );
              console.log("click : ", selectedBoundaryIndex);
            }
          }
          isDragging = true;

        }
      };

      const handleMouseMove = (e) => {

        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);

        if (!isDragging) {
          const isCreatMode = (activeTool.value === 'bone-create');
          bonesInstance.GetCloestBoneAsHoverBone(xNDC, yNDC, isCreatMode);
          if (activeTool.value === 'edit-points') {
            glsInstance.updateLayerVertices(gl, glsInstance.layers[currentChosedLayer.value]);
          }
          else if (activeTool.value === 'edit-boundary') {
            mousePosition.value = glsInstance.updateMousePosition(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value]);

          }
          return;
        }

        if (activeTool.value === 'grab-point' && isDragging) {

          bonesInstance.moveSelectedVertex(currentChosedLayer, useMultiSelect, localSelectedVertex, gl, xNDC, yNDC, dragStartX, dragStartY);
          dragStartX = xNDC;
          dragStartY = yNDC;

          forceUpdate();

        } else if (activeTool.value === 'select-points') {

          if (isDragging)
            bonesInstance.handleSelectPointsMouseMove(xNDC, yNDC, isShiftPressed.value);

        }
        else if (activeTool.value === 'edit-points') {

          if (isDragging && selectedVertex.value !== -1) {
            let vertexIndex = selectedVertex.value;
            console.log("currentChosedLayer.value : ", currentChosedLayer.value)
            glsInstance.updateLayerVertices(gl, glsInstance.layers[currentChosedLayer.value], { update: [{ index: vertexIndex, x: xNDC, y: yNDC }] });
            forceUpdate();
          }

        }
        else if (activeTool.value === 'link-points') {



        }
        else if (activeTool.value === 'bone-create') {

          // console.log(" mouse move event : ", e.buttons);  // in mouse move e.buttons: 1:left, 2:right, 3:left+right
          if (e.buttons === 2) {  //edit selected bone
            //   console.log(" right button move edit bone...  ");
            bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
          }
          else {
            //console.log(" left button move create bone...  ");
            bonesInstance.meshboneCreateMouseMove(xNDC, yNDC);
          }

        } else if (activeTool.value === 'bone-animate') {
          bonesInstance.handleMeshBoneAnimateMouseDown(xNDC, yNDC);
          bonesInstance.updatePoseMesh(gl);
          forceUpdate();
          // console.log(" xNDC: ",xNDC," , yNDC",yNDC);
          //   startPosX = xNDC;
          //    startPosY = yNDC;
        } else if (activeTool.value === 'edit-boundary') {
          if (e.button === 0) {
            console.log("doing boundary interact mouse moving ..", selectedBoundaryIndex);

            if (selectedBoundaryIndex !== -1)
              glsInstance.updateBoundary(xNDC, yNDC, selectedBoundaryIndex, glsInstance.layers[currentChosedLayer.value], isShiftPressed.value,
              );

          }
        }
      };

      const handleMouseUp = (e) => {
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);
        mousePressed.value = e.button;

        if (activeTool.value === 'bone-create' && isDragging) {

          if (e.button === 2) { //edit selected bone
            bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
          }
          else {
            bonesInstance.MeshBoneCreate(xNDC, yNDC);
          }


          //bonesInstance.assignVerticesToBones();
        }
        else if (activeTool.value === 'select-points') {
          if (isDragging) {
            bonesInstance.handleSelectPointsMouseUp(xNDC, yNDC, currentChosedLayer.value, isShiftPressed.value, isCtrlPressed.value);
            isDragging = false;
          }
        }


        else if (activeTool.value === 'bone-animate' && isDragging) {
          // bonesInstance.handleBoneAnimateMouseUp();
        }

        else if (activeTool.value === 'link-points') {
          if (e.button === 0) {

            let vertex2 = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value].vertices.value);
            console.log("link point select first vertex at  ", selectedVertex.value);
            console.log("link point select second vertex at  ", vertex2);
            if (vertex2 !== -1 && selectedVertex.value !== -1 && vertex2 !== selectedVertex.value) {
              glsInstance.updateLayerVertices(gl, glsInstance.layers[currentChosedLayer.value], { addEdge: [{ v1: selectedVertex.value, v2: vertex2 }] });
            }
          }
        }
        else if (activeTool.value === 'delete-edge') {
          if (e.button === 0) {

            let vertex2 = getClosestVertex(xNDC, yNDC, glsInstance.layers[currentChosedLayer.value].vertices.value);
            console.log("link point select first vertex at  ", selectedVertex.value);
            console.log("link point select second vertex at  ", vertex2);
            if (vertex2 !== -1 && selectedVertex.value !== -1 && vertex2 !== selectedVertex.value) {
              glsInstance.updateLayerVertices(gl, glsInstance.layers[currentChosedLayer.value], { deleteEdge: [{ v1: selectedVertex.value, v2: vertex2 }] });
            }
          }
        } else if (activeTool.value === 'edit-boundary') {

          selectedBoundaryIndex = -1;
          // glsInstance.resetMouseState( glsInstance.layers[currentChosedLayer.value]);
        }
        isDragging = false;
        selectedVertex.value = -1;


        forceUpdate();
      };

      const handleWheel = (e) => {
        e.preventDefault();
        console.log('wheel', e.deltaY);
      };

      // 綁定事件
      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('wheel', handleWheel);

      // （可選）在 component unmount 或重新繪製時解除綁定
      // return () => {
      //   canvas.removeEventListener('mousedown', handleMouseDown);
      //   canvas.removeEventListener('mousemove', handleMouseMove);
      //   canvas.removeEventListener('mouseup', handleMouseUp);
      //   canvas.removeEventListener('wheel', handleWheel);
      // };
    };

    const initAnything = (async () => {

      //  if( !texture.value)
      if (lastLoadedImageType.value == 'png') {
        //if no texture render first time
        if (!texture.value)
          await pngRender();

        else {
          await pngRenderAgain();
        }
      }
      else if (lastLoadedImageType.value === 'psd') {
        //await psdRenderAgain(selectedLayers, wholeImageHeight.value, wholeImageWidth.value);
        await psdRender(selectedLayers, wholeImageHeight.value, wholeImageWidth.value);
      }


      showLayers.value = glsInstance.layers;

    });

    const toggleMeshSelection = (index) => {
      console.log(" toggle layer selection : ", index);
      if (chosenMesh.value.includes(index)) {
        chosenMesh.value = chosenMesh.value.filter(i => i !== index)
      } else {
        chosenMesh.value.push(index)
      }
      console.log(" chosenMesh.value : ", chosenMesh.value);


      // checking chosenMesh.includes(index)
      console.log(" chosenMesh includes index? ", chosenMesh.value.includes(index));
    }
    // ... existing imports

    // 找到原本的 addMesh 函式並替換為以下內容
    const addMesh = () => {
      console.log(" hi add addMesh ");

      // 檢查是否有選中圖層
      if (glsInstance.layers.length > 0 && currentChosedLayer.value !== null && currentChosedLayer.value < glsInstance.layers.length) {

        const sourceLayerIndex = currentChosedLayer.value;
        const sourceLayer = glsInstance.layers[sourceLayerIndex];

        // 1. 建立新圖層
        const newLayerName = sourceLayer.name.value + "_Copy";
        const newLayer = glsInstance.addLayer(newLayerName);
        const newIndex = glsInstance.layers.length - 1;

        // 2. 深拷貝幾何數據
        newLayer.vertices.value = [...sourceLayer.vertices.value];
        newLayer.indices.value = [...sourceLayer.indices.value];
        newLayer.linesIndices.value = [...sourceLayer.linesIndices.value];
        newLayer.poseVertices.value = [...sourceLayer.poseVertices.value];

        // 3. 拷貝 Set 結構
        if (sourceLayer.edges) newLayer.edges = new Set(sourceLayer.edges);
        if (sourceLayer.originalTriangles) newLayer.originalTriangles = new Set(sourceLayer.originalTriangles);

        // 4. 深拷貝變形參數 (關鍵：讓位置正確)
        if (sourceLayer.transformParams) newLayer.transformParams = JSON.parse(JSON.stringify(sourceLayer.transformParams));
        if (sourceLayer.transformParams2) newLayer.transformParams2 = JSON.parse(JSON.stringify(sourceLayer.transformParams2));

        // 5. 複製圖片引用
        newLayer.image = sourceLayer.image;
        newLayer.width = sourceLayer.width;
        newLayer.height = sourceLayer.height;

        // 6. 為主圖層建立 WebGL Buffers
        const { vbo, ebo, eboLines } = glsInstance.createWebGLBuffers(
          gl.value,
          newLayer.vertices.value,
          newLayer.indices.value,
          newLayer.linesIndices.value
        );
        newLayer.vbo = vbo;
        newLayer.ebo = ebo;
        newLayer.eboLines = eboLines;

        // 7. 同步處理 Ref Layer (避免 ghost layer 問題)
        // gls.addLayer 自動建立了 refLayer，我們也需要幫它初始化 buffer
        const refLayer = glsInstance.refLayers[newIndex];
        if (refLayer) {
          const { vbo: rvbo, ebo: rebo, eboLines: reboLines } = glsInstance.createWebGLBuffers(
            gl.value,
            newLayer.vertices.value,
            newLayer.indices.value,
            newLayer.linesIndices.value
          );
          refLayer.vbo = rvbo;
          refLayer.ebo = rebo;
          refLayer.eboLines = reboLines;
          refLayer.transformParams = JSON.parse(JSON.stringify(newLayer.transformParams));
          refLayer.vertices.value = [...newLayer.vertices.value]; // 同步頂點
        }

        // 8. 處理紋理 (Texture)
        if (texture.value && texture.value[sourceLayerIndex]) {
          texture.value.push(texture.value[sourceLayerIndex]);
        }

        // 9. 同步加入 Mesh2D 列表
        const newMeshObj = new Mesh2D(newLayerName);
        newMeshObj.image = loadedImage.value || sourceLayer.image;
        newMeshObj.vertices = [...newLayer.vertices.value];
        newMeshObj.indices = [...newLayer.indices.value];
        newMeshObj.linesIndices = [...newLayer.linesIndices.value];
        meshs.value.push(newMeshObj);

        // ==========================
        // 🔥 關鍵修正：自動選中與顯示
        // ==========================

        // A. 加入渲染清單 (讓貼圖顯示)
        if (!selectedLayers.value.includes(newIndex)) {
          selectedLayers.value.push(newIndex);
        }

        // B. 切換當前操作圖層 (讓 Vertex 紅點顯示)
        currentChosedLayer.value = newIndex;

        // C. 更新 UI 高亮 (chosenLayers)
        // 先清空舊選擇 (如果是單選邏輯) 或者 push (如果是多選)
        // 這裡假設單選操作比較直覺
        chosenLayers.value = [newIndex];

        // 10. 更新畫面
        showLayers.value = glsInstance.layers;
        forceUpdate();

        console.log(`✅ 已複製並選中 Mesh 圖層: ${newLayerName} (Index: ${newIndex})`);

      } else {
        console.warn("⚠️ 未選中圖層，無法複製 Mesh");
      }
    }
    const fitLayerBoundary = () => {
      fitTransformToVertices(glsInstance.layers[currentChosedLayer.value]);
    }
    const fitLayerBoundary2 = () => {
      fitTransformToVertices2(glsInstance.layers[currentChosedLayer.value]);
    }
    onMounted(async () => {
      renderFn.value = await loadHtmlPage('./meshEditor.html');

      await nextTick();
      drawGlCanvas();
      console.log("is gl already init? ", initGlAlready.value);
      if (!initGlAlready.value) {
        // === 第一次載入 ===
        lastLoadedImageType.value = 'png';
        clearTexture(selectedLayers);
        await pngLoadTexture('./png3.png');
        initGlAlready.value = true;
        await initAnything(); // 這是原本的初始化邏輯
      } else {
        // === 頁面切換回來 (包含新增的圖層) ===
        console.log("🔄 Switching back page, restoring existing layers...");

        // 使用新功能：恢復所有圖層 (包含 addMesh 新增的)
        await restoreWebGLResources(gl.value);
}
        // 確保 GL 狀態綁定正確
        await bindGl(selectedLayers);

        // 同步顯示列表
        showLayers.value = glsInstance.layers;
      
      const beforePasses = [];

      // 權重繪製模式
      beforePasses.push(
        makeRenderPass(
          render,
          gl.value, program.value, glsInstance.refLayers, selectedLayers)
      )


      const passes = [];

      // 根據模式動態加入 pass
      {
        // 權重繪製模式
        passes.push(
          makeRenderPass(
            renderGridOnly,
            gl.value,
            colorProgram.value,
            glsInstance.layers,
            glsInstance.getLayerSize(),
            currentChosedLayer,
            selectedVertices
          ),


          makeRenderPass(
            renderWeightPaint,
            gl.value,
            weightPaintProgram.value,
            selectedGroups.value[0],
            glsInstance.layers[currentChosedLayer.value]
          ),

          makeRenderPass(
            renderOutBoundary,
            gl.value,
            colorProgram.value,
            glsInstance.layers,
            glsInstance.getLayerSize(),
            currentChosedLayer,
            selectedVertices
          ),


        );
      }


      // === 骨架渲染（所有模式都要）===
      passes.push(
        makeRenderPass(
          renderMeshSkeleton,
          gl.value,
          skeletonProgram.value,
          meshSkeleton,
          bonesInstance,
          mousePressed,
          activeTool
        )
      );
      if (activeTool.value === 'bone-animate') { //update pose if in animate mode
        bonesInstance.updatePoseMesh(gl.value);
      }
      setCurrentJobName('edit');
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers, passes, "edit", beforePasses);

    });
    const layoutState = reactive({
      rightPanelWidth: 300, // 右側面板初始寬度
      layersHeight: 250,    // 圖層區塊初始高度
      isResizing: false
    });

    // 處理拖曳手柄
    const startResize = (type, event) => {
      layoutState.isResizing = true;
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = layoutState.rightPanelWidth;
      const startHeight = layoutState.layersHeight;

      const onMouseMove = (moveEvent) => {
        if (type === 'right-panel') {
          // 向左拖動會增加寬度，所以是 startX - currentX
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

    const getCorrectedNDC = (e, canvas) => {
      const rect = canvas.getBoundingClientRect();

      // 1. 取得滑鼠在 Canvas DOM 元素上的像素位置 (尚未考慮縮放)
      // 注意：這裡假設 canvas 的 CSS transform 是由父層 .canvas-viewport 控制的
      // 如果直接 transform canvas，rect 會是被縮放後的大小

      // 我們改用 event.clientX 減去 容器的偏移，再扣除 camera 的位移，除以 zoom
      const container = canvas.closest('.canvas-area');
      const containerRect = container.getBoundingClientRect();

      // 滑鼠相對於 canvas-area 左上角的像素位置
      const mouseXInContainer = e.clientX - containerRect.left;
      const mouseYInContainer = e.clientY - containerRect.top;

      // 轉換為相對於「實際畫布內容」的像素位置 (反向應用平移與縮放)
      const contentX = (mouseXInContainer - camera.x) / camera.zoom;
      const contentY = (mouseYInContainer - camera.y) / camera.zoom;

      // 接著轉為 NDC (-1 ~ 1)
      // 假設畫布的渲染尺寸是 canvas.width / canvas.height
      const xNDC = (contentX / canvas.width) * 2 - 1;
      const yNDC = 1 - (contentY / canvas.height) * 2; // WebGL Y 軸向上，DOM 向下

      return { x: xNDC, y: yNDC };
    };

    // 處理滑鼠滾輪縮放
    const handleWheel = (e) => {
      if (!e.altKey && !e.ctrlKey && activeTool.value !== 'move-view') {
        // 如果沒有按特殊鍵，你可以選擇是否要攔截，這裡示範直接縮放
      }

      const zoomIntensity = 0.1;
      const direction = e.deltaY > 0 ? -1 : 1;
      const factor = 1 + (zoomIntensity * direction);

      // 計算縮放前的滑鼠在「內容世界」的相對位置，讓縮放以滑鼠為中心
      const container = document.querySelector('.canvas-area');
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const worldX = (mouseX - camera.x) / camera.zoom;
      const worldY = (mouseY - camera.y) / camera.zoom;

      // 更新 Zoom
      const newZoom = Math.max(0.1, Math.min(5.0, camera.zoom * factor));
      camera.zoom = newZoom;

      // 更新 Pan (補償位移)
      camera.x = mouseX - worldX * newZoom;
      camera.y = mouseY - worldY * newZoom;
    };

    // 處理中鍵平移 (Pan)
    // 修改後的 handlePan：只允許中鍵拖曳
    const handlePan = (e) => {
      // e.button === 1 代表中鍵 (滾輪鍵)
      if (e.button === 1) {
        e.preventDefault(); // 防止瀏覽器預設的捲動圖示出現

        const startX = e.clientX;
        const startY = e.clientY;
        const startCamX = camera.x;
        const startCamY = camera.y;

        const onMouseMove = (moveE) => {
          // 更新相機位置
          camera.x = startCamX + (moveE.clientX - startX);
          camera.y = startCamY + (moveE.clientY - startY);
        };

        const onMouseUp = () => {
          // 放開滑鼠後移除監聽
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        // 綁定到 window 以確保拖曳出畫布範圍也能偵測
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    };
    // --- 2. 畫布相機控制 (Camera Logic) ---
    const camera = reactive({
      x: 0,
      y: 0,
      zoom: 1.0
    });

    onUnmounted(() => {
      console.log("unmount edit page, cleaning up gl context...");
      if (gl.value) {
        gl.value.deleteProgram(program.value);
        gl.value.deleteProgram(colorProgram.value);
        gl.value.deleteProgram(skeletonProgram.value);
        gl.value = null;
        setCurrentJobName("exit");
      }
    });
    return () =>
      renderFn.value
        ? renderFn.value({
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
        })
        : h('div', '載入中...');

  },
});
