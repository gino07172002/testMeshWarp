//Editor.js
import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, h, nextTick } = Vue;
import { globalVars as v, triggerRefresh, loadHtmlPage } from './globalVars.js'  // 引入全局變數

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
  pngRender
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
export const meshEditor = defineComponent({
  name: 'Editor',
  setup() {
    const counter = useCounterStore();
    const renderFn = ref(null);

    onMounted(async () => {
      doRenderAgain();
      renderFn.value = await loadHtmlPage('./meshEditor.html');

      await nextTick();
      drawGlCanvas();

      await pngRender('./png3.png', [], 0, 0);
      console.log("checking texture : ",texture.value.length);
      if (glsInstance.layers.length > 0)
        render(gl.value, program.value, colorProgram.value, skeletonProgram.value, glsInstance.layers);

    });

    return () =>
      renderFn.value
        ? renderFn.value({ counter, v, triggerRefresh })
        : h('div', '載入中...');
  },
});


const doRender = () => {
  console.log("hi do Render!");
}
const doRenderAgain = () => {
  console.log("hi do Render Again=!");
}