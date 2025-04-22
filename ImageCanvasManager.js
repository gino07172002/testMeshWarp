// ImageCanvasManager.js
export default class ImageCanvasManager {
  constructor(vueInstance) {
    this.imageData = '';
    this.cacheBuster = Date.now();
    this.points = [];
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.updateTimer = null;
    this.vueInstance = vueInstance;
  }

  initialize() {
    document.addEventListener('click', this.handleClickOutside.bind(this));
    this.startImageUpdates();
  }

  cleanup() {
    clearInterval(this.updateTimer);
    document.removeEventListener('click', this.handleClickOutside);
  }

  fetchImage() {
    // Placeholder for image fetching
  }

  startImageUpdates() {
    this.fetchImage();
    this.updateTimer = setInterval(() => {
      this.fetchImage();
    }, 200);
  }

  handleCanvasClick(event) {
    this.fetchImage();
  }

  closeAllDropdowns() {
    this.vueInstance.fileDropdown = false;
    this.vueInstance.editDropdown = false;
  }

  toggleDropdown(dropdown) {
    this.closeAllDropdowns();
    if (dropdown === 'fileDropdown') {
      this.vueInstance.fileDropdown = !this.vueInstance.fileDropdown;
    } else if (dropdown === 'editDropdown') {
      this.vueInstance.editDropdown = !this.vueInstance.editDropdown;
    }
  }

  handleFileAction(action) {
    this.vueInstance.status = `執行檔案動作: ${action}`;
    this.closeAllDropdowns();
    if (action === 'save') {
      this.vueInstance.saveProjectToServer();
    }
  }

  handleEditAction(action) {
    this.vueInstance.status = `執行編輯動作: ${action}`;
    this.closeAllDropdowns();
  }

  updateImage(newUrl) {
    this.cacheBuster = Date.now();
  }

  getMousePosition(event) {
    const rect = this.vueInstance.$refs.imageContainer.getBoundingClientRect();
    const scrollLeft = this.vueInstance.$refs.imageContainer.scrollLeft;
    const scrollTop = this.vueInstance.$refs.imageContainer.scrollTop;
    const x = event.clientX - rect.left + scrollLeft;
    const y = event.clientY - rect.top + scrollTop;
    return { x, y };
  }

  handleCanvasMouseDown(event) {
    const { x, y } = this.getMousePosition(event);
    event.preventDefault();
    if (event.button === 0) {
      this.isDragging = true;
      this.dragStartX = x;
      this.dragStartY = y;
      this.vueInstance.status = `開始拖曳: x=${x}, y=${y}`;
      fetch('/api/clickStart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          x,
          y,
          scw: this.vueInstance.$refs.imageContainer.scrollWidth,
          sch: this.vueInstance.$refs.imageContainer.scrollHeight
        })
      });
    } else if (event.button === 2) {
      this.vueInstance.status = `右鍵點擊: x=${x}, y=${y}`;
      if (this.points.length > 0) {
        this.points.pop();
        this.vueInstance.status = `右鍵移除最後一個點，剩餘 ${this.points.length} 個點`;
      }
    }
    this.updateImage('/png');
  }

  handleCanvasMouseMove(e) {
    if (!this.isDragging) return;
    const { x, y } = this.getMousePosition(e);
    if (e.ctrlKey) {
      this.vueInstance.status = `拖曳中with ctrl : x=${x}, y=${y}`;
    } else {
      this.vueInstance.status = `拖曳中: x=${x}, y=${y}`;
    }
    this.sendDragToServer(x, y, e);
  }

  handleCanvasMouseUp(e) {
    const { x, y } = this.getMousePosition(e);
    if (e.button === 0) {
      if (this.isDragging) {
        this.isDragging = false;
        const dx = x - this.dragStartX;
        const dy = y - this.dragStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 5) {
          this.handleLeftClick(x, y, e);
        } else {
          this.handleDragEnd(x, y, e);
        }
      }
    }
  }

  handleLeftClick(x, y) {
    this.vueInstance.status = `左鍵點擊: x=${x}, y=${y}`;
    this.points.push({ x, y });
    this.sendPointToServer(x, y);
  }

  getBasePayload(x, y, event) {
    const payload = {
      x,
      y,
      scw: this.vueInstance.$refs.imageContainer.scrollWidth,
      sch: this.vueInstance.$refs.imageContainer.scrollHeight
    };
    ['ctrlKey', 'shiftKey', 'altKey'].forEach(key => {
      if (event && event[key]) {
        payload[key] = true;
      }
    });
    return payload;
  }

  handleDragEnd(x, y, event) {
    const payload = this.getBasePayload(x, y, event);
    this.vueInstance.status = `拖曳結束: 從 (${this.dragStartX}, ${this.dragStartY}) 到 (${x}, ${y})`;
    fetch('/api/dragDone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  sendPointToServer(x, y, event) {
    const payload = this.getBasePayload(x, y, event);
    fetch('/api/points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(response => response.json())
      .then(data => {
        this.points.push({ x: data.x, y: data.y });
        this.vueInstance.status = `最近的網格點: x=${data.x}, y=${data.y}`;
      })
      .catch(error => {
        this.vueInstance.status = 'point bad: ' + error.message;
      });
  }

  sendDragToServer(x, y, event) {
    const payload = this.getBasePayload(x, y, event);
    fetch('/api/drag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  clearPoints() {
    this.points = [];
    this.vueInstance.status = '已清除所有點';
  }

  handleClickOutside() {
    this.closeAllDropdowns();
  }
}