// apiService.js

/**
 * API Service 模組，負責與後端 API 進行通訊。
 */
const apiService = (() => {
  // 基礎 API URL
  const BASE_URL = 'https://api.example.com';

  /**
   * 發送 HTTP 請求到指定的 API 端點。
   * @param {string} endpoint - API 的端點名稱，例如 '/users' 或 '/products'。
   * @param {string} method - HTTP 方法，例如 'GET', 'POST', 'PUT', 'DELETE'。
   * @param {Object} data - 要傳遞的 JSON 資料（如果是 GET 請求，則可以是查詢參數）。
   * @returns {Promise} - 返回一個 Promise，解析後是後端回應的資料。
   */
  const request = async (endpoint, method, data = null) => {
    try {
      // 構建完整的 URL
      const url = `${BASE_URL}${endpoint}`;

      // 設定 fetch 選項
      const options = {
        method: method.toUpperCase(), // 確保方法名稱是大寫
        headers: {
          'Content-Type': 'application/json',
        },
      };

      // 如果是 POST 或 PUT 請求，附加 body
      if (method.toUpperCase() !== 'GET' && data) {
        options.body = JSON.stringify(data);
      }

      // 如果是 GET 請求，附加查詢參數
      if (method.toUpperCase() === 'GET' && data) {
        const queryParams = new URLSearchParams(data).toString();
        options.url = `${url}?${queryParams}`;
      }

      // 發送請求
      const response = await fetch(url, options);

      // 檢查回應狀態
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      // 解析回應資料
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('API Request Failed:', error);
      throw error; // 將錯誤拋出，讓調用者處理
    }
  };

  // 公開方法
  return {
    get: (endpoint, params = null) => request(endpoint, 'GET', params),
    post: (endpoint, data) => request(endpoint, 'POST', data),
    put: (endpoint, data) => request(endpoint, 'PUT', data),
    delete: (endpoint, data = null) => request(endpoint, 'DELETE', data),
  };
})();

export default apiService;