//Editor.js
import { useCounterStore, Mesh2D } from './mesh.js';
const { defineComponent, ref, onMounted, onUnmounted, h, nextTick, inject, computed } = Vue;
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
              isDragging = true;
            }
          }


        }
      };

      const handleMouseMove = (e) => {

        const { x: xNDC, y: yNDC } = convertToNDC(e, canvas, container);

        if (!isDragging) {
          const isCreatMode = (activeTool.value === 'bone-create');
          bonesInstance.GetCloestBoneAsHoverBone(xNDC, yNDC, isCreatMode);

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
 const addMesh = () => {
      console.log(" hi add addMesh ");

      //copy layers[currentChosedLayer]'s vertices, indices, linesIndices to new mesh
      if (glsInstance.layers.length > 0 && currentChosedLayer.value < glsInstance.layers.length) {
        const layer = glsInstance.layers[currentChosedLayer.value];
        const newMesh = new Mesh2D();
       // console.log(" layer vertices : ", JSON.stringify(layer.vertices.value));

       // console.log(" layer indices : ", JSON.stringify(layer.indices.value));
        newMesh.name = "mesh_" + (meshs.value.length + 1);
        newMesh.image=loadedImage;
        newMesh.vertices = [...layer.vertices.value];

        newMesh.indices= [...layer.indices.value];
        newMesh.linesIndices= [...layer.linesIndices.value];
        meshs.value.push(newMesh);
      }
    }
    onMounted(async () => {
      renderFn.value = await loadHtmlPage('./meshEditor.html');

      await nextTick();
      drawGlCanvas();
      console.log("is gl already init? ", initGlAlready.value);
      if (!initGlAlready.value) {
        lastLoadedImageType.value = 'png';
        clearTexture(selectedLayers);
        await pngLoadTexture('./png3.png')
        initGlAlready.value = true;
      }
      await initAnything();

      await bindGl(selectedLayers);

      const beforePasses = [];

      // 權重繪製模式
      beforePasses.push(
        makeRenderPass(
          render,
          gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.refLayers, selectedLayers)
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
          selectedMesh
        })
        : h('div', '載入中...');

  },
});
