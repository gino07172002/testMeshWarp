//allEditor.js
import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, onUnmounted, h, nextTick, inject, computed, watch, reactive } = Vue;
import {
  globalVars as v, triggerRefresh, loadHtmlPage, convertToNDC, mousePressed, isShiftPressed, forceUpdate, initGlAlready,
  wholeImageWidth,
  wholeImageHeight,
  lastLoadedImageType,
  selectedLayers,
  getRawXY
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
import {
  psdHello,
  processPSDFile

} from './psd.js';

import {
  Timeline2
} from './timeline2.js';
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
  restoreWebGLResources
} from './useWebGL.js';

import glsInstance from './useWebGL.js';


//load meshEditor.html at beginning
export const allEditor = defineComponent({
  name: 'allEditor',
  setup() {
    console.log("setting editor page .. ");

    const counter = useCounterStore();
    const renderFn = ref(null);
    // inject values provided by root app (fallbacks kept for standalone use)
    const activeTool = inject('activeTool', ref('grab-point'));
    const selectTool = inject('selectTool', (tool) => { console.warn('selectTool not provided', tool); });
    const bindingBoneWeight = inject('bindingBoneWeight', (w) => { console.warn('bindingBoneWeight not provided', w); });

    const skeletons = inject('skeletons', ref([]));
    const selectedItem = inject('selectedItem', ref(null));
    const showLayers = inject('showLayers', ref([]));
    const chosenLayers = inject('chosenLayers', ref([]));
    const selectedGroups = inject('selectedGroups', ref([]));
    const lastSelectedBone = inject('lastSelectedBone', ref(null));
    const currentChosedLayer = inject('currentChosedLayer', ref(null));
    const vertexGroupInfo = inject('vertexGroupInfo', ref(null));
    const editingGroup = inject('editingGroup', ref(null));
    const weightValue = inject('weightValue', ref(0));
    const timelineLength = inject('timelineLength', ref(1000));
    const playheadPosition = inject('playheadPosition', ref(null));

    const timelineList = inject('timelineList', ref([new Timeline2('main', 2.0)]));
    const selectedTimelineId = inject('selectedTimelineId', ref(0));
    const timeline2 = inject('timeline2', computed(() => timelineList.value[selectedTimelineId.value]));

    // inject functions (fallback to local no-ops)
    const onAdd = inject('onAdd', () => { });
    const onRemove = inject('onRemove', () => { });
    const onAssign = inject('onAssign', () => { });
    const onSelect = inject('onSelect', () => { });
    const setWeight = inject('setWeight', () => { });
    const choseTimelineId = inject('choseTimelineId', () => { console.log('choseTimelineId not provided'); });
    const renameTimeline = inject('renameTimeline', () => { console.log('renameTimeline not provided'); });
    const addTimeline = inject('addTimeline', () => { console.log('addTimeline not provided'); });
    const removeTimeline = inject('removeTimeline', () => { console.log('removeTimeline not provided'); });
    const addKeyframe = inject('addKeyframe', () => { console.log('addKeyframe not provided'); });
    const removeKeyframe = inject('removeKeyframe', () => { console.log('removeKeyframe not provided'); });
    // const handlePSDUpload = inject('handlePSDUpload', () => { console.log('handlePSDUpload not provided'); });
    // const psdImage = inject('psdImage', () => { console.log('psdImage not provided'); });
    const playAnimation = inject('playAnimation', () => { console.log('playAnimation not provided'); });
    const exportSkeletonToSpineJson = inject('exportSkeletonToSpineJson', () => { console.log('exportSkeletonToSpineJson not provided'); });
    const saveSpineJson = inject('saveSpineJson', () => { console.log('saveSpineJson not provided'); });
    const selectTimeline = inject('selectTimeline', () => { console.log(' selectTimeline not provided'); });
    const expandedNodes = inject('expandedNodes', () => { console.log('expandedNodes not provided'); });
    const toggleNode = inject('toggleNode', () => { console.log('toggleNode not provided'); });
    const handleNameClick = inject('handleNameClick', () => { console.log('handleNameClick not provided'); });
    const toggleLayerSelection = inject('toggleLayerSelection', () => { console.log('toggleLayerSelection not provided'); });
    const toggleSelect = inject('toggleSelect', () => { console.log('toggleSelect not provided'); });
    const firstImage = inject('firstImage', () => { console.log('firstImage not provided'); });

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

    function setupCanvasEvents(canvas, gl, container) {
      let isDragging = false;
      let alreadySelect = false;
      let localSelectedVertex = -1;
      let startPosX = 0;
      let startPosY = 0;
      let useMultiSelect = true;
      let dragStartX = 0, dragStartY = 0; // 記錄滑鼠起始點

      const handleMouseDown = (e) => {
        mousePressed.value = e.button;
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);
        const { x: x, y: y } = getRawXY(e, canvas, container);

        startPosX = xNDC;
        startPosY = yNDC;

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
            bonesInstance.handleSelectPointsMouseDown(xNDC, yNDC, x, y);
            isDragging = true;

          }

          else if (activeTool.value === 'bone-create') {
            if (e.button === 2) {
              console.log(" right button down edit bone...  ");
              //   bonesInstance.handleMeshBoneEditMouseDown(xNDC, yNDC);
              bonesInstance.handleMeshBoneEditMouseDown(x, y);
              isDragging = true;
            }
            else {
              //  if(!getBone)
              //  bonesInstance.handleMeshBoneCreateMouseDown(xNDC, yNDC, isShiftPressed.value);

              bonesInstance.handleMeshBoneCreateMouseDown(x, y, isShiftPressed.value);
              isDragging = true;
            }
          } else if (activeTool.value === 'bone-animate') {
            //bonesInstance.GetCloestBoneAsSelectBone(xNDC, yNDC, false);
            bonesInstance.GetCloestBoneAsSelectBone(x, y, false);
            isDragging = true;
          }
        }
      };

      const handleMouseMove = (e) => {

        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);
        const { x: x, y: y } = getRawXY(e, canvas, container);

        if (!isDragging) {
          const isCreatMode = (activeTool.value === 'bone-create');
          //  bonesInstance.GetCloestBoneAsHoverBone(xNDC, yNDC, isCreatMode);
          bonesInstance.GetCloestBoneAsHoverBone(x, y, isCreatMode);

          return;
        }

        if (activeTool.value === 'grab-point' && isDragging) {

          bonesInstance.moveSelectedVertex(currentChosedLayer, useMultiSelect, localSelectedVertex, gl, xNDC, yNDC, dragStartX, dragStartY);
          dragStartX = xNDC;
          dragStartY = yNDC;

          forceUpdate();

        } else if (activeTool.value === 'select-points') {
          if (isDragging)
            bonesInstance.handleSelectPointsMouseMove(xNDC, yNDC, x, y);

        }

        else if (activeTool.value === 'bone-create') {

          // console.log(" mouse move event : ", e.buttons);  // in mouse move e.buttons: 1:left, 2:right, 3:left+right
          if (e.buttons === 2) {  //edit selected bone
            //   console.log(" right button move edit bone...  ");
            // bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
            bonesInstance.meshBoneEditMouseMove(x, y);
            // console.log(" get raw x y", { x, y });
          }
          else {
            //console.log(" left button move create bone...  ");
            //bonesInstance.meshboneCreateMouseMove(xNDC, yNDC);
            bonesInstance.meshboneCreateMouseMove(x, y);
          }

        } else if (activeTool.value === 'bone-animate') {
          // bonesInstance.handleMeshBoneAnimateMouseDown(xNDC, yNDC);
          bonesInstance.handleMeshBoneAnimateMouseDown(x, y);

          bonesInstance.updatePoseMesh(gl);
          forceUpdate();
          // console.log(" xNDC: ",xNDC," , yNDC",yNDC);
          //   startPosX = xNDC;
          //    startPosY = yNDC;
        }
      };

      const handleMouseUp = (e) => {
        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);
        const { x: x, y: y } = getRawXY(e, canvas, container);

        console.log("mouse : ", { x, y });
        console.log("canvas: ", wholeImageWidth.value, " , ", wholeImageHeight.value);
        mousePressed.value = e.button;
        if (activeTool.value === 'bone-create' && isDragging) {

          if (e.button === 2) { //edit selected bone
            //bonesInstance.meshBoneEditMouseMove(xNDC, yNDC);
            bonesInstance.meshBoneEditMouseMove(x, y);
          }
          else {
            //  bonesInstance.MeshBoneCreate(xNDC, yNDC);
            bonesInstance.MeshBoneCreate(x, y);
          }


          //bonesInstance.assignVerticesToBones();
        }
        else if (activeTool.value === 'select-points') {
          if (isDragging) {
            bonesInstance.handleSelectPointsMouseUp(xNDC, yNDC, currentChosedLayer.value, isShiftPressed.value, isCtrlPressed.value, x, y);
            isDragging = false;
          }
        }


        else if (activeTool.value === 'bone-animate' && isDragging) {
          // bonesInstance.handleBoneAnimateMouseUp();
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
    }
    function syncLayers() {
      //forceUpdate();
      showLayers.value = glsInstance.layers;
    }
    const currentTimeline = inject('currentTimeline', computed(() => timelineList.value[selectedTimelineId.value]));
    const psdImage = async () => {
      if (!gl.value) return;
      lastLoadedImageType.value = 'psd';
      console.log(" checking psd image width height: ", wholeImageWidth.value, wholeImageHeight.value);
      await psdRender(selectedLayers, wholeImageHeight.value, wholeImageWidth.value);
      await bindGl(selectedLayers);
      syncLayers();
      showLayers.value = glsInstance.layers;
      console.log("checking layers: ", showLayers.value.length);
      //construct necessary pass


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
          )
        );
      }


      // === 骨架渲染（所有模式都要）===
      passes.push(
        /*
        makeRenderPass(
          renderMeshSkeleton,
          gl.value,
          skeletonProgram.value,
          meshSkeleton,
          bonesInstance,
          mousePressed,
          activeTool
        )
          */
        makeRenderPass(
          renderMeshSkeleton2,
          gl.value,
          skeletonProgram.value,
          meshSkeleton,
          bonesInstance,
          mousePressed,
          activeTool,
          wholeImageWidth.value,
          wholeImageHeight.value
        )
      );

      setCurrentJobName("psd");
      console.log(" selectedLayers value in allEditor psdImage(): ", selectedLayers.value);

      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers, passes, "psd");
    };
    const createLayerTexture = (gl, layer) => {
      if (!layer || !layer.imageData) {
        console.error("Layer or layer.imageData is undefined:", layer);
        return null;
      }

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);

      //console.log("Processing layer:", layer.name, "ImageData type:", Object.prototype.toString.call(layer.imageData));

      // Handle different types of imageData
      if (layer.imageData instanceof ImageData) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, layer.imageData.width, layer.imageData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, layer.imageData.data);
      } else if (layer.imageData instanceof HTMLCanvasElement || layer.imageData instanceof HTMLImageElement) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.imageData);
      } else if (ArrayBuffer.isView(layer.imageData)) {
        // Handle Uint8Array, Uint8ClampedArray etc.
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = layer.width;
        tempCanvas.height = layer.height;
        const tempCtx = tempCanvas.getContext('2d');
        const tempImageData = tempCtx.createImageData(layer.width, layer.height);
        tempImageData.data.set(layer.imageData);
        tempCtx.putImageData(tempImageData, 0, 0);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tempCanvas);
      } else {
        console.error("Unsupported layer.imageData type for layer:", layer.name, layer.imageData);
        console.log("Data preview:", layer.imageData && layer.imageData.length ? layer.imageData.slice(0, 20) : "No data");
        return null;
      }

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      return texture;
    };
    let layersForTexture = [];
    const handlePSDUpload = (async (event) => {
      try {
        const file = event.target.files[0];
        if (file) {
          layersForTexture = [];
          const psdInfo = await processPSDFile(file);
          let psdLayers = psdInfo.layers;

          let imageWidth = psdInfo.width;
          let imageHeight = psdInfo.height;
          wholeImageHeight.value = imageHeight;

          wholeImageWidth.value = imageWidth;
          console.log(" processed psd image width height: ", wholeImageHeight.value, wholeImageWidth.value);
          const glContext = gl.value; // WebGL context from useWebGL.js



          for (const layer of psdLayers) {
            // Create texture for the layer
            layer.texture = createLayerTexture(glContext, layer);

            // Calculate NDC coordinates based on layer position and size
            const left = layer.left || 0;
            const top = layer.top || 0;
            const right = left + (layer.width || imageWidth);
            const bottom = top + (layer.height || imageHeight);

            const ndcLeft = (left / imageWidth) * 2 - 1;
            const ndcRight = (right / imageWidth) * 2 - 1;
            const ndcTop = 1 - (top / imageHeight) * 2;
            const ndcBottom = 1 - (bottom / imageHeight) * 2;

            // Define vertices for the quad (position and texture coordinates)
            const layerVertices = [
              ndcLeft, ndcBottom, 0, 0,   // Bottom-left
              ndcRight, ndcBottom, 1, 0,  // Bottom-right
              ndcRight, ndcTop, 1, 1,     // Top-right
              ndcLeft, ndcTop, 0, 1       // Top-left
            ];

            console.log("checking layerVertices: ", layerVertices)
            // Create and populate vertex buffer object (VBO)
            layer.vbo = glContext.createBuffer();
            glContext.bindBuffer(glContext.ARRAY_BUFFER, layer.vbo);
            glContext.bufferData(glContext.ARRAY_BUFFER, new Float32Array(layerVertices), glContext.STATIC_DRAW);

            // Create and populate element buffer object (EBO) for triangles
            layer.ebo = glContext.createBuffer();
            glContext.bindBuffer(glContext.ELEMENT_ARRAY_BUFFER, layer.ebo);
            glContext.bufferData(glContext.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), glContext.STATIC_DRAW);

            // 將圖層轉換成與 PNG 相同的資料結構格式
            const layerForTexture = {
              imageData: layer.imageData, // 假設 PSD 圖層已經有 imageData (Uint8Array 格式)
              width: layer.width,
              height: layer.height,
              // 如果需要額外的圖層資訊，可以加上：
              left: layer.left || -1,
              top: layer.top || 1,
              name: layer.name || `Layer ${layersForTexture.length}`,
              opacity: layer.opacity || 1.0,
              blendMode: layer.blendMode || 'normal'
            };
            console.log("let see new psd layer: ", layer.top, " , ", layer.left);


            layersForTexture.push(layerForTexture);
          }
          layerForTextureWebgl.value = layersForTexture;


          console.log(" then renew canvas... ");



        }
      } catch (error) {
        console.error("處理 PSD 檔案時出錯:", error);
      }

    });
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
        await psdRenderAgain(selectedLayers, wholeImageHeight.value, wholeImageWidth.value);
      }

      showLayers.value = glsInstance.layers;

    });

    const onLayerCheckChange = (index, event) => {
      if (event.target.checked) {
        if (!selectedLayers.value.includes(index)) {
          selectedLayers.value.push(index);
        }
      } else {
        const idx = selectedLayers.value.indexOf(index);
        if (idx > -1) {
          selectedLayers.value.splice(idx, 1);
        }
      }
    };
    const testCountQQ = ref(0);
    const onLayerCheckChange2 = (event) => {
      console.log('✅ 勾選變更:', JSON.stringify(selectedLayers2.value))
      testCountQQ.value += 1;
      console.log(" testCount value: ", testCountQQ.value);
      // 這裡可以執行你想做的任何邏輯
    }
    onMounted(async () => {
      console.log("mount edit page! .. ");

      renderFn.value = await loadHtmlPage('./allEditor.html');

      await nextTick();
      drawGlCanvas();
      console.log("is gl already init? ", initGlAlready.value);
      if (!initGlAlready.value) {
        // === 第一次載入 ===
        lastLoadedImageType.value = 'png';
        clearTexture(selectedLayers);
        await pngLoadTexture('./png3.png')
        initGlAlready.value = true;
        await initAnything();
      } else {
        // === 頁面切換回來 (包含 addMesh 新增的圖層) ===
        console.log("🔄 Restoring layers in AllEditor...");

        // 呼叫恢復函式，而不是 initAnything/pngRenderAgain
        await restoreWebGLResources(gl.value);
 }
        // 確保 GL 狀態綁定
        await bindGl(selectedLayers);

        // 更新 UI 列表
        showLayers.value = glsInstance.layers;
     
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
          )
        );
      }


      // === 骨架渲染（所有模式都要）===

      passes.push(
        makeRenderPass(
           () => bonesInstance.updateSlotAttachments()
        ),
        makeRenderPass(
          renderMeshSkeleton2,
          gl.value,
          skeletonProgram.value,
          meshSkeleton,
          bonesInstance,
          mousePressed,
          activeTool,
          wholeImageWidth.value,
          wholeImageHeight.value
        )
      );
      if (activeTool.value === 'bone-animate') { //update pose if in animate mode
        bonesInstance.updatePoseMesh(gl.value);
      }
      setCurrentJobName('edit');
      render2(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers, selectedLayers, passes, "edit");




    });
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
    const slotVisibleChange = () => {
      console.log("hi slotVisibleChange ");
    };
    const slotAttachmentChange = () => {
      console.log("hi slotAttachmentChange ");
    };
    const slotReorder = () => {
      console.log("hi slotReorder");
    };
    const layoutState = reactive({
      rightPanelWidth: 280,
      layersHeight: 200,
      // 如果需要更多垂直調整，可以加更多變數，例如 propsHeight
    });
    const layers = computed(() => {
      return glsInstance.layers || [];
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
          bindingBoneWeight,
          skeletons,
          selectedItem,
          showLayers,
          selectedLayers,
          chosenLayers,
          selectedGroups,
          lastSelectedBone,
          currentChosedLayer,
          vertexGroupInfo,
          editingGroup,
          weightValue,
          onAdd,
          onRemove,
          onAssign,
          onSelect,
          setWeight,
          timeline2,
          timelineList,
          selectedTimelineId,
          choseTimelineId,
          currentTimeline,
          renameTimeline,
          addTimeline,
          removeTimeline,
          addKeyframe,
          removeKeyframe,
          handlePSDUpload,
          psdImage,
          playAnimation,
          exportSkeletonToSpineJson,
          saveSpineJson,
          timelineLength,
          playheadPosition,
          selectTimeline,
          expandedNodes,
          toggleNode,
          handleNameClick,
          toggleLayerSelection,
          toggleSelect,
          firstImage,
          onLayerCheckChange,
          onLayerCheckChange2,
          testCountQQ,
          startResize,
          layoutState,
          slotVisibleChange,
          slotAttachmentChange,
          slotReorder,
          layers
        })
        : h('div', '載入中...');
  },
});

const doRenderAgain = () => {
  console.log("hi do Render Again=!");
}