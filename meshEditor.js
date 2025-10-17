//Editor.js
import { useCounterStore } from './mesh.js';
const { defineComponent, ref, onMounted, h } = Vue;
import { globalVars as v,triggerRefresh, loadHtmlPage } from './globalVars.js'  // 引入全局變數
import {
  gl,
  texture,
  program,
  colorProgram,
  skeletonProgram,
  weightPaintProgram,
  skinnedProgram,

} from './useWebGL.js';


//load meshEditor.html at beginning
export const meshEditor = defineComponent({
  name: 'Editor',
  setup() {
    const counter = useCounterStore();
    const renderFn = ref(null);
    
    onMounted(async () => {
      renderFn.value = await loadHtmlPage('./meshEditor.html');
    });
    
    return () =>
      renderFn.value
        ? renderFn.value({ counter, v, triggerRefresh })
        : h('div', '載入中...');
  },
});