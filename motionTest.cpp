#include <cstdio>
#include <cstdlib>
#include <string>
#include <fstream>
#include <iostream>
#include <vector>
#include <map>
#include "mongoose.h"
#include "json.hpp"
#include <opencv2/opencv.hpp>

#include <unordered_set>
#include <functional>
#include <opencv2/core/ocl.hpp>
#include <thread>
#include <vector>
#include <mutex>
#include <atomic>
#include <functional>
//#include "gameObject.h"

using json = nlohmann::json;

using namespace cv;
using namespace std;
UMat image;
UMat image_post;

// Base64 encoding function
std::string base64_encode(const unsigned char* data, size_t length) {
    static const std::string base64_chars =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "abcdefghijklmnopqrstuvwxyz"
        "0123456789+/";

    std::string encoded;
    int i = 0;
    int j = 0;
    unsigned char char_array_3[3];
    unsigned char char_array_4[4];

    while (length--) {
        char_array_3[i++] = *(data++);
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;

            for (i = 0; i < 4; i++)
                encoded += base64_chars[char_array_4[i]];
            i = 0;
        }
    }

    if (i) {
        for (j = i; j < 3; j++)
            char_array_3[j] = '\0';

        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);

        for (j = 0; j < i + 1; j++)
            encoded += base64_chars[char_array_4[j]];

        while (i++ < 3)
            encoded += '=';
    }

    return encoded;
}

// Helper function to encode vector of bytes
std::string base64_encode(const std::vector<unsigned char>& data) {
    return base64_encode(data.data(), data.size());
}
// 處理HTTP請求的回調函數
void http_handler(struct mg_connection* conn, int ev, void* ev_data, void* fn_data) {
    if (ev == MG_EV_HTTP_MSG) {
        struct mg_http_message* hm = (struct mg_http_message*)ev_data;

        // 處理根路徑請求 - 顯示HTML頁面
        if (mg_match(hm->uri, mg_str("/image"), NULL)) {
            // 配置圖片路徑，這裡假設圖片名為 "image.jpg" 並位於當前目錄
            // 讀取 PNG 圖片，保留 Alpha 通道
            Mat image = imread("png.png", IMREAD_UNCHANGED);

            std::cout << " image channel: " << image.channels() << std::endl;
            if (image.empty()) {
                mg_printf(conn, "HTTP/1.1 500 Internal Server Error\r\n"
                    "Content-Type: text/plain\r\n"
                    "Content-Length: 20\r\n\r\n"
                    "Failed to load image");
                return;
            }

            std::cout << "Read image size: " << image.size() << ", Channels: " << image.channels() << std::endl;

            // 使用 OpenCV imencode 將 Mat 轉換成 PNG 二進制數據
            std::vector<uchar> buffer;
            if (!imencode(".png", image, buffer)) {
                mg_printf(conn, "HTTP/1.1 500 Internal Server Error\r\n"
                    "Content-Type: text/plain\r\n"
                    "Content-Length: 22\r\n\r\n"
                    "Failed to encode image");
                return;
            }

            // 設置 HTTP 響應標頭
            mg_printf(conn, "HTTP/1.1 200 OK\r\n"
                "Content-Type: image/png\r\n"
                "Content-Length: %d\r\n\r\n", (int)buffer.size());

            // 發送圖片數據
            mg_send(conn, buffer.data(), buffer.size());
        }

        // 處理其他路徑請求 - 返回404錯誤
        else {
            // Serve web root directory
            struct mg_http_serve_opts opts = { 0 };
            opts.root_dir = ".";
            opts.ssi_pattern = "#.html";
            mg_http_serve_dir(conn, hm, &opts);
        }

    }
}


void displayOpenCLDeviceInfo() {
    // 檢查 OpenCV 是否支援 OpenCL
    if (!cv::ocl::haveOpenCL()) {
        std::cout << "OpenCV 的 OpenCL 支援未啟用或不可用。" << std::endl;
        return;
    }

    std::cout << "OpenCV 支援 OpenCL。" << std::endl;

    // 取得預設的 OpenCL 平台和裝置
    cv::ocl::Context context;
    if (!context.create(cv::ocl::Device::TYPE_ALL)) {
        std::cout << "無法建立 OpenCL 上下文。" << std::endl;
        return;
    }

    std::cout << "可用的 OpenCL 裝置資訊：" << std::endl;

    // 列出所有可用的 OpenCL 裝置
    for (int i = 0; i < context.ndevices(); ++i) {
        cv::ocl::Device device = context.device(i);
        std::cout << "裝置 " << i + 1 << ":" << std::endl;
        std::cout << "  名稱: " << device.name() << std::endl;
        std::cout << "  類型: " << device.type() << std::endl;
        std::cout << "  廠商: " << device.vendorName() << std::endl;
        std::cout << "  驅動版本: " << device.driverVersion() << std::endl;
        std::cout << "  OpenCL 版本: " << device.OpenCL_C_Version() << std::endl;
        std::cout << "  記憶體大小: " << device.globalMemSize() / (1024 * 1024) << " MB" << std::endl;
        std::cout << "  最大工作群組大小: " << device.maxWorkGroupSize() << std::endl;
        std::cout << "  最大計算單元數: " << device.maxComputeUnits() << std::endl;
        std::cout << "-----------------------------" << std::endl;
    }
}

void grayscaleWithOpenCL(const std::string& imagePath) {
    // 檢查 OpenCV 是否支援 OpenCL
    if (!cv::ocl::haveOpenCL()) {
        std::cout << "OpenCV 的 OpenCL 支援未啟用或不可用。" << std::endl;
        return;
    }

    // 啟用 OpenCL 加速
    cv::ocl::setUseOpenCL(true);

    // 讀取影像
    cv::UMat inputImage, grayImage; // 使用 UMat 以啟用 OpenCL 加速
    inputImage = cv::imread(imagePath, cv::IMREAD_COLOR).getUMat(cv::ACCESS_READ);
    if (inputImage.empty()) {
        std::cerr << "無法讀取影像: " << imagePath << std::endl;
        return;
    }

    // 轉換為灰階影像
    cv::cvtColor(inputImage, grayImage, cv::COLOR_BGR2GRAY);

    // 檢查是否確實使用了 OpenCL
    if (cv::ocl::useOpenCL()) {
        std::cout << "OpenCL 已啟用，影像處理已加速。" << std::endl;
    }
    else {
        std::cout << "OpenCL 未啟用，影像處理使用 CPU。" << std::endl;
    }

    // 儲存結果
    std::string outputImagePath = "output_gray_image.jpg";

    // 顯示結果（可選）
    cv::imshow("Input Image", inputImage);
    cv::imshow("Gray Image", grayImage);
    cv::waitKey(0);
}

void startOclIfExist()
{

    // 檢查 OpenCV 是否支援 OpenCL
    if (!cv::ocl::haveOpenCL()) {
        std::cout << "OpenCV 的 OpenCL 支援未啟用或不可用。" << std::endl;
        return;
    }

    // 啟用 OpenCL 加速
    cv::ocl::setUseOpenCL(true);
}
int main() {

    displayOpenCLDeviceInfo();
    startOclIfExist();

    std::cout << "OpenCL enabled: " << cv::ocl::useOpenCL() << std::endl;
    // grayscaleWithOpenCL("test.jpg");
    std::cout << " go go hh ..." << std::endl;

    struct mg_mgr mgr;
    mg_mgr_init(&mgr);

    image = imread("png3.png", IMREAD_UNCHANGED).getUMat(cv::ACCESS_READ);
    image_post = image.clone();

    // 設置HTTP服務器監聽地址和端口
    const char* listen_addr = "http://0.0.0.0:8000";
    mg_http_listen(&mgr, listen_addr, (mg_event_handler_t)http_handler, NULL);

    std::cout << "Mongoose Image Server v7 啟動在 " << listen_addr << std::endl;
    std::cout << "請在瀏覽器中訪問 http://localhost:8000" << std::endl;
    std::cout << "確保當前目錄下有名為 'image.jpg' 的圖片文件" << std::endl;
    std::cout << "按 Ctrl+C 退出服務器" << std::endl;

    // 事件循環
    while (true) {
        mg_mgr_poll(&mgr, 1000);
    }

    // 釋放資源
    mg_mgr_free(&mgr);
    return 0;
}
