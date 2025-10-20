//allEditor.js
import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, h, nextTick, inject, computed } = Vue;
import { globalVars as v, triggerRefresh, loadHtmlPage } from './globalVars.js'  // 引入全局變數
import {
  //initBone,
  boneParents,
  meshSkeleton,
  skeletons,
  lastSelectedBone,
  selectedVertices
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

const drawGlCanvas = async () => {
  const canvas = document.getElementById('webgl');
  const webglContext = canvas.getContext('webgl');
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
  // setupCanvasEvents(canvas, gl.value, container);

  // 创建着色器程序
  program.value = glsInstance.createProgram(gl.value, shaders.vertex, shaders.fragment);
  colorProgram.value = glsInstance.createProgram(gl.value, shaders.colorVertex, shaders.colorFragment);
  skeletonProgram.value = glsInstance.createProgram(gl.value, shaders.skeletonVertex, shaders.skeletonFragment);
  weightPaintProgram.value = glsInstance.createProgram(gl.value, shaders.weightPaintVertex, shaders.weightPaintFragment);
  skinnedProgram.value = glsInstance.createProgram(gl.value, shaders.skinnedVertex, shaders.skinnedFragment);

};
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