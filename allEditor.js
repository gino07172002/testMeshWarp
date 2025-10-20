//allEditor.js
import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, h, nextTick, inject, computed } = Vue;
import { globalVars as v, triggerRefresh, loadHtmlPage, convertToNDC } from './globalVars.js'  // 引入全局變數
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
  renderGridOnly,
  pngRender,
  renderMeshSkeleton

} from './useWebGL.js';

import glsInstance from './useWebGL.js';


//load meshEditor.html at beginning
export const allEditor = defineComponent({
  name: 'allEditor',
  setup() {

    const counter = useCounterStore();
    const renderFn = ref(null);
    // inject values provided by root app (fallbacks kept for standalone use)
    const activeTool = inject('activeTool', ref('grab-point'));
    const selectTool = inject('selectTool', (tool) => { console.warn('selectTool not provided', tool); });
    const bindingBoneWeight = inject('bindingBoneWeight', (w) => { console.warn('bindingBoneWeight not provided', w); });

    const skeletons = inject('skeletons', ref([]));
    const selectedItem = inject('selectedItem', ref(null));
    const showLayers = inject('showLayers', ref([]));
    const selectedLayers = inject('selectedLayers', ref([]));
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
    const handlePSDUpload = inject('handlePSDUpload', () => { console.log('handlePSDUpload not provided'); });
    const psdImage = inject('psdImage', () => { console.log('psdImage not provided'); });
    const playAnimation = inject('playAnimation', () => { console.log('playAnimation not provided'); });
    const exportSkeletonToSpineJson = inject('exportSkeletonToSpineJson', () => { console.log('exportSkeletonToSpineJson not provided'); });
    const saveSpineJson = inject('saveSpineJson', () => { console.log('saveSpineJson not provided'); });
    const selectTimeline = inject('selectTimeline', () => { console.log(' selectTimeline not provided'); });
    const expandedNodes = inject('expandedNodes', () => { console.log('expandedNodes not provided'); });
    const toggleNode = inject('toggleNode', () => { console.log('toggleNode not provided'); });
    const handleNameClick = inject('handleNameClick', () => { console.log('handleNameClick not provided'); });
    const toggleLayerSelection = inject('toggleLayerSelection', () => { console.log('toggleLayerSelection not provided'); });

    const mousePressed = ref();
    const selectedVertex = ref(-1);
    const isShiftPressed = ref(false);
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
            bonesInstance.handleSelectPointsMouseDown(xNDC, yNDC, e.button === 0, isShiftPressed.value);
            isDragging = true;

          }

          else if (activeTool.value === 'bone-create') {
            if (e.button === 2) {
              console.log(" right button down edit bone...  ");
              bonesInstance.handleMeshBoneEditMouseDown(xNDC, yNDC);
              isDragging = true;
            }
            else {
              //  if(!getBone)
              bonesInstance.handleMeshBoneCreateMouseDown(xNDC, yNDC, isShiftPressed.value);
              //bonesInstance.handleBoneCreateMouseDown(xNDC, yNDC, isShiftPressed.value);
              isDragging = true;
            }
          } else if (activeTool.value === 'bone-animate') {
            bonesInstance.GetCloestBoneAsSelectBone(xNDC, yNDC, false);

            isDragging = true;
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
        isDragging = false;
        selectedVertex.value = -1;
        mousePressed.value = null;

        //  forceUpdate();
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
    const currentTimeline = inject('currentTimeline', computed(() => timelineList.value[selectedTimelineId.value]));
    onMounted(async () => {
      console.log("is array1?:", Array.isArray(chosenLayers.value))
      doRenderAgain();
      console.log("is array2?:", Array.isArray(chosenLayers.value))
      renderFn.value = await loadHtmlPage('./allEditor.html');

      await nextTick();
      drawGlCanvas();
      await pngRender('./png3.png', [], 0, 0);
      console.log("checking texture : ", texture.value.length);
      if (glsInstance.layers.length > 0) {
        render(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers);
        renderGridOnly(gl.value, colorProgram.value, glsInstance.layers[currentChosedLayer.value], glsInstance.getLayerSize(), currentChosedLayer.value, []);
        if (typeof renderMeshSkeleton === 'function' && meshSkeleton) {
          //  renderMeshSkeleton(gl.value, skeletonProgram.value, meshSkeleton, bonesInstance, mousePressed, activeTool.value === "bone-animate");
        }
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
          toggleLayerSelection
        })
        : h('div', '載入中...');
  },
});

const doRenderAgain = () => {
  console.log("hi do Render Again=!");
}