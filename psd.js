
let width, height;

// 解碼圖層通道數據（原始數據或RLE壓縮）
function decodeChannel(view, offset, compression, w, h) {
  if (compression === 0) {
    const size = w * h;
    const data = new Uint8Array(view.buffer, offset, size);
    offset += size;
    return { data, offset };
  } else if (compression === 1) {
    const rowCounts = [];
    for (let y = 0; y < h; y++) {
      rowCounts[y] = view.getUint16(offset);
      offset += 2;
    }
    const data = new Uint8Array(w * h);
    let ptr = 0;
    for (let y = 0; y < h; y++) {
      let bytesLeft = rowCounts[y];
      while (bytesLeft > 0) {
        const len = new Int8Array(view.buffer, offset, 1)[0];
        offset++;
        bytesLeft--;
        if (len >= 0 && len <= 127) {
          const run = new Uint8Array(view.buffer, offset, len + 1);
          data.set(run, ptr);
          offset += len + 1;
          ptr += len + 1;
          bytesLeft -= len + 1;
        } else if (len >= -127 && len <= -1) {
          const val = new Uint8Array(view.buffer, offset, 1)[0];
          offset++;
          bytesLeft--;
          const count = 1 - len;
          for (let i = 0; i < count; i++) {
            data[ptr++] = val;
          }
        }
      }
    }
    return { data, offset };
  } else {
    throw new Error('不支援的壓縮方法');
  }
}


// 讀取PSD文件並解析圖層
function readPSD(file, callback) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const buffer = e.target.result;
    const view = new DataView(buffer);
    const signature = String.fromCharCode(...new Uint8Array(buffer.slice(0, 4)));
    if (signature !== '8BPS') {
      alert('不是PSD文件');
      return;
    }
    const numChannels = view.getUint16(12);
    const height = view.getUint32(14);  // PSD檔案總高度
    const width = view.getUint32(18);   // PSD檔案總寬度
    const depth = view.getUint16(22);
    const colorMode = view.getUint16(24);
    let offset = 26;
    const colorDataLen = view.getUint32(offset);
    offset += 4 + colorDataLen;
    const imageResLen = view.getUint32(offset);
    offset += 4 + imageResLen;
    const layerMaskLen = view.getUint32(offset);
    offset += 4;
    const layerEnd = offset + layerMaskLen;

    // 建立 PSD 資訊物件
    const psdInfo = {
      width: width,
      height: height,
      numChannels: numChannels,
      depth: depth,
      colorMode: colorMode
    };

    if (layerMaskLen > 0) {
      const layerInfoLen = view.getUint32(offset);
      offset += 4;
      const numLayers = view.getInt16(offset);
      offset += 2;
      const layers = [];
      for (let i = 0; i < Math.abs(numLayers); i++) {
        const top = view.getInt32(offset);
        const left = view.getInt32(offset + 4);
        const bottom = view.getInt32(offset + 8);
        const right = view.getInt32(offset + 12);
        const chCount = view.getUint16(offset + 16);
        offset += 18;
        const channels = [];
        for (let j = 0; j < chCount; j++) {
          const id = view.getInt16(offset);
          const length = view.getUint32(offset + 2);
          channels.push({ id, length });
          offset += 6;
        }
        const blendSig = String.fromCharCode(...new Uint8Array(buffer.slice(offset, offset + 4)));
        const blendKey = String.fromCharCode(...new Uint8Array(buffer.slice(offset + 4, offset + 8)));
        const opacity = new Uint8Array(buffer.slice(offset + 8, offset + 9))[0];
        offset += 12;
        const extraLen = view.getUint32(offset);
        offset += 4 + extraLen;
        layers.push({ top, left, bottom, right, channels, opacity });
      }
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const w = layer.right - layer.left;
        const h = layer.bottom - layer.top;
        if (w <= 0 || h <= 0) continue;
        const channelData = {};
        for (let j = 0; j < layer.channels.length; j++) {
          const ch = layer.channels[j];
          const compression = view.getUint16(offset);
          offset += 2;
          const decodeResult = decodeChannel(view, offset, compression, w, h);
          channelData[ch.id] = decodeResult.data;
          offset = decodeResult.offset;
        }
        const imageData = new Uint8ClampedArray(w * h * 4);
        for (let p = 0; p < w * h; p++) {
          const r = channelData[0] ? channelData[0][p] : 0;    // 紅
          const g = channelData[1] ? channelData[1][p] : 0;    // 綠
          const b = channelData[2] ? channelData[2][p] : 0;    // 藍
          const a = channelData[3] ? channelData[3][p] : (channelData[-1] ? channelData[-1][p] : 255); // Alpha
          imageData[p * 4] = r;
          imageData[p * 4 + 1] = g;
          imageData[p * 4 + 2] = b;
          imageData[p * 4 + 3] = a;
        }
        layers[i].width = w;
        layers[i].height = h;
        layers[i].x = layer.left;
        layers[i].y = layer.top;
        layers[i].imageData = imageData;
        layers[i].opacity = layer.opacity;
        layers[i].left = 2 * (layers[i].left / width) - 1;
        layers[i].right = 2 * (layers[i].right / width) - 1;
        layers[i].top = 1 - 2 * (layers[i].top / height);
        layers[i].bottom = 1 - 2 * (layers[i].bottom / height);
      }

      psdInfo.layers = layers;
    } else {
      psdInfo.layers = [];
    }

    offset = layerEnd;

    // 將 PSD 資訊傳遞給回調函數
    callback(psdInfo);
  };
  reader.readAsArrayBuffer(file);
}

// 修复后的 processPSDFile 函数
function processPSDFile(file) {
  return new Promise((resolve, reject) => {
    readPSD(file, function(psdInfo) {
      try {
        // 在這裡可以進行額外的處理
        console.log('PSD 處理完成:', psdInfo);
        resolve(psdInfo);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// 如果你想保留原來的事件監聽器，可以這樣使用新函數：
document.getElementById('psdFile').addEventListener('change', function () {
  processPSDFile(this.files[0]);
});

// 導出函數，使它可以在別的文件中使用
// 如果使用 ES6 模塊:
// export { processPSDFile, allLayers, width, height, drawSelectedLayers };

// 或者，如果直接在全局範圍中使用:
// 只需確保在你的 app.js 中在此文件之後加載，這樣這些函數就直接可用

function psdHello() {
  console.log("Hello from psd.js module!");
}

export {
  psdHello,
  processPSDFile
};
