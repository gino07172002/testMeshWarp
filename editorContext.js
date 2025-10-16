// editorContext.js
import { reactive, watch } from 'vue'

// === 初始化階段：從 localStorage 還原 session ===
const savedSession = JSON.parse(localStorage.getItem('editor-session') || '{}')

// === 全域編輯器狀態 ===
export const editorContext = reactive({
  // === 影像相關 ===
  currentImage: savedSession.currentImage || null,  // 當前影像（URL/Base64/Blob 等）
  selectedLayer: savedSession.selectedLayer || null, // 目前選取圖層
  zoomLevel: savedSession.zoomLevel || 1,            // 縮放比例

  // === 工具與 UI ===
  tool: savedSession.tool || 'move',                 // move / crop / brush / etc.
  theme: savedSession.theme || 'dark',
  showGrid: savedSession.showGrid ?? true,

  // === 歷史與復原 ===
  history: savedSession.history || [],
  undoStack: savedSession.undoStack || [],

  // === 系統狀態 ===
  isLoading: false,
  error: null,
})

// === 常用操作方法 ===
export function setTool(toolName) {
  editorContext.tool = toolName
}

export function pushHistory(stateSnapshot) {
  editorContext.history.push(stateSnapshot)
  // 限制歷史長度避免爆記憶體
  if (editorContext.history.length > 50) {
    editorContext.history.shift()
  }
}

export function undo() {
  const prev = editorContext.history.pop()
  if (prev) {
    editorContext.undoStack.push({ ...editorContext })
    Object.assign(editorContext, prev)
  }
}

export function redo() {
  const next = editorContext.undoStack.pop()
  if (next) {
    pushHistory({ ...editorContext })
    Object.assign(editorContext, next)  //Object.assign 會覆蓋原本的屬性並保持 reactivity (第一層)
  }
}

export function resetEditor() {
  Object.assign(editorContext, {
    currentImage: null,
    selectedLayer: null,
    zoomLevel: 1,
    tool: 'move',
    showGrid: true,
    history: [],
    undoStack: [],
  })
  localStorage.removeItem('editor-session')
}

// === 自動儲存 session 至 localStorage ===
watch(
  editorContext,
  (val) => {
    localStorage.setItem('editor-session', JSON.stringify(val))
  },
  { deep: true }
)
