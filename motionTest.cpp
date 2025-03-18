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
#include "KDTree.h"

using json = nlohmann::json;

using namespace cv;
using namespace std;
Mat image;

GridNode* findNearestGridNodeOptimized(const std::vector<GridNode>& gridNodes, const myPoint& targetPoint) {
    // 這裡我們假設要使用 KD 樹方法
    // 實際使用時，建議先建構 KD 樹，然後多次查詢
    static KDTree kdTree;
    static bool initialized = false;
    std::cout << "init ? " << initialized << std::endl;

    // 首次調用時初始化 KD 樹
    if (!initialized) {
        // 將 const 轉換為非 const，因為 KDTree 需要存儲指向 gridNodes 的指針
        std::vector<GridNode>& nonConstGridNodes = const_cast<std::vector<GridNode>&>(gridNodes);
        kdTree.build(nonConstGridNodes);
        initialized = true;
    }

    return kdTree.findNearest(targetPoint);
}
// 定義MIME類型映射
std::map<std::string, std::string> mime_types = {
    {".jpg", "image/jpeg"},
    {".jpeg", "image/jpeg"},
    {".png", "image/png"},
    {".gif", "image/gif"},
    {".bmp", "image/bmp"},
    {".ico", "image/x-icon"}
};

// 判斷文件擴展名並返回對應的MIME類型
std::string get_mime_type(const std::string& path) {
    size_t dot_pos = path.find_last_of(".");
    if (dot_pos != std::string::npos) {
        std::string ext = path.substr(dot_pos);
        auto it = mime_types.find(ext);
        if (it != mime_types.end()) {
            return it->second;
        }
    }
    return "application/octet-stream";  // 默認二進制流
}

// 將文件內容讀取到內存中
bool read_file(const std::string& path, std::vector<char>& content) {
    std::cout << "read path ... " << path << std::endl;
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        return false;
    }

    file.seekg(0, std::ios::end);
    size_t size = file.tellg();
    file.seekg(0, std::ios::beg);

    content.resize(size);
    file.read(content.data(), size);

    return file.good();
}

json gridNodesToJson(const std::vector<GridNode>& gridNodes) {
    json nodesJson = json::array();
    for (const auto& node : gridNodes) {
        nodesJson.push_back({ {"x", node.position.x}, {"y", node.position.y} });
    }
    return nodesJson;
}
// 檢查三角形是否包含任何非透明且屬於中央色塊的像素
bool triangleHasColor(const Mat& image, const Mat& centralMask, myPoint pt1, myPoint pt2, myPoint pt3) {
    // 創建三角形的遮罩
    Mat triangleMask = Mat::zeros(image.size(), CV_8UC1);
    std::vector<Point> points = {
        Point(round(pt1.x), round(pt1.y)),
        Point(round(pt2.x), round(pt2.y)),
        Point(round(pt3.x), round(pt3.y))
    };
    std::vector<std::vector<Point>> contours = { points };
    fillPoly(triangleMask, contours, Scalar(255));

    // 提取 alpha 通道
    std::vector<Mat> channels;
    split(image, channels);
    Mat alpha = channels[3];

    // 將三角形遮罩與中央色塊遮罩和 alpha 通道結合
    Mat combinedMask;
    bitwise_and(centralMask, triangleMask, combinedMask); // 先限制在中央色塊範圍內
    Mat maskedAlpha;
    bitwise_and(alpha, combinedMask, maskedAlpha); // 然後檢查 alpha 通道

    // 檢查遮罩區域內是否有顏色
    return countNonZero(maskedAlpha) > 0;
}

// 生成三角形網格
std::vector<GridNode> generateTriangleGrid(const Mat& image, const Mat& centralMask, Rect region, int gridSize) {
    std::vector<GridNode> gridNodes;
    float dx = gridSize;
    float dy = gridSize * sqrt(3) / 2;  // 正三角形高度

    int rows = region.height / dy;
    int cols = region.width / dx;

    // 首先，創建所有網格節點
    for (int row = 0; row <= rows; row++) {
        for (int col = 0; col <= cols; col++) {
            float x = region.x + col * dx + (row % 2) * (dx / 2);
            float y = region.y + row * dy;
            myPoint pt = { x, y };
            gridNodes.push_back({ pt });
        }
    }

    // 建立鄰接關係
    int totalCols = cols + 1;
    for (size_t i = 0; i < gridNodes.size(); i++) {
        int row = i / totalCols;
        int col = i % totalCols;

        if (col > 0) gridNodes[i].neighbors.push_back(&gridNodes[i - 1]); // 左
        if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i + 1]); // 右

        if (row > 0) {
            if (row % 2 == 0) {
                if (col > 0) gridNodes[i].neighbors.push_back(&gridNodes[i - totalCols - 1]); // 左上
                if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i - totalCols]); // 右上
            }
            else {
                gridNodes[i].neighbors.push_back(&gridNodes[i - totalCols]); // 左上
                if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i - totalCols + 1]); // 右上
            }
        }

        if (row < rows) {
            if (row % 2 == 0) {
                if (col > 0) gridNodes[i].neighbors.push_back(&gridNodes[i + totalCols - 1]); // 左下
                if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i + totalCols]); // 右下
            }
            else {
                gridNodes[i].neighbors.push_back(&gridNodes[i + totalCols]); // 左下
                if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i + totalCols + 1]); // 右下
            }
        }
    }

    // 現在，篩選出不組成帶有有色像素的三角形的節點
    std::vector<GridNode> validNodes;
    std::vector<bool> isValid(gridNodes.size(), false);

    // 檢查每個節點的三角形
    for (size_t i = 0; i < gridNodes.size(); i++) {
        int row = i / totalCols;
        int col = i % totalCols;
        myPoint pt = gridNodes[i].position;

        // 檢查每個節點與其他節點形成的三角形
        // 向下的三角形
        if (row < rows && col < cols) {
            myPoint pt2, pt3;
            if (row % 2 == 0) {
                // 偶數行
                pt2 = { pt.x + dx, pt.y };            // 右
                pt3 = { pt.x + dx / 2, pt.y + dy };     // 下
            }
            else {
                // 奇數行
                pt2 = { pt.x + dx, pt.y };            // 右
                pt3 = { pt.x - dx / 2, pt.y + dy };     // 左下
            }

            if (triangleHasColor(image, centralMask, pt, pt2, pt3)) {
                isValid[i] = true;
                // 找出 pt2 和 pt3 的索引並標記它們為有效
                for (size_t j = 0; j < gridNodes.size(); j++) {
                    if (abs(gridNodes[j].position.x - pt2.x) < 0.1 &&
                        abs(gridNodes[j].position.y - pt2.y) < 0.1) {
                        isValid[j] = true;
                    }
                    if (abs(gridNodes[j].position.x - pt3.x) < 0.1 &&
                        abs(gridNodes[j].position.y - pt3.y) < 0.1) {
                        isValid[j] = true;
                    }
                }
            }
        }

        // 向上的三角形
        if (row > 0 && col < cols) {
            myPoint pt2, pt3;
            if (row % 2 == 0) {
                // 偶數行
                pt2 = { pt.x + dx, pt.y };            // 右
                pt3 = { pt.x + dx / 2, pt.y - dy };     // 上
            }
            else {
                // 奇數行
                pt2 = { pt.x + dx, pt.y };            // 右
                pt3 = { pt.x + dx * 1.5f, pt.y - dy };   // 右上
            }

            if (triangleHasColor(image, centralMask, pt, pt2, pt3)) {
                isValid[i] = true;
                // 找出 pt2 和 pt3 的索引並標記它們為有效
                for (size_t j = 0; j < gridNodes.size(); j++) {
                    if (abs(gridNodes[j].position.x - pt2.x) < 0.1 &&
                        abs(gridNodes[j].position.y - pt2.y) < 0.1) {
                        isValid[j] = true;
                    }
                    if (abs(gridNodes[j].position.x - pt3.x) < 0.1 &&
                        abs(gridNodes[j].position.y - pt3.y) < 0.1) {
                        isValid[j] = true;
                    }
                }
            }
        }
    }

    // 創建最終有效節點列表
    for (size_t i = 0; i < gridNodes.size(); i++) {
        if (isValid[i]) {
            validNodes.push_back(gridNodes[i]);
        }
    }

    // 重建僅適用於有效節點的鄰接關係
    for (auto& node : validNodes) {
        std::vector<GridNode*> validNeighbors;
        for (auto* neighbor : node.neighbors) {
            // 檢查此鄰居是否在我們的有效節點中
            for (auto& validNode : validNodes) {
                if (abs(validNode.position.x - neighbor->position.x) < 0.1 &&
                    abs(validNode.position.y - neighbor->position.y) < 0.1) {
                    validNeighbors.push_back(&validNode);
                    break;
                }
            }
        }
        node.neighbors = validNeighbors;
    }

    return validNodes;
}

// 提取中央色塊並建立三角形網格
std::vector<GridNode> extractGridPoints(Mat& image, int gridSize) {
    std::vector<GridNode> gridNodes;

    // 讀取 Alpha 通道
    Mat alpha;
    std::vector<Mat> channels;
    split(image, channels);
    alpha = channels[3];

    // 建立二值圖
    Mat binary;
    threshold(alpha, binary, 1, 255, THRESH_BINARY);

    // 找出輪廓
    std::vector<std::vector<Point>> contours;
    findContours(binary, contours, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE);

    if (contours.empty()) {
        std::cout << "No objects detected!" << std::endl;
        return gridNodes;
    }

    // 找到最接近中心的色塊
    Point imgCenter(image.cols / 2, image.rows / 2);
    double minDist = DBL_MAX;
    std::vector<Point> bestContour;
    for (const auto& contour : contours) {
        Rect bbox = boundingRect(contour);
        Point bboxCenter(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
        double dist = norm(bboxCenter - imgCenter);
        if (dist < minDist) {
            minDist = dist;
            bestContour = contour;
        }
    }

    // 創建一個只包含中央色塊的遮罩
    Mat centralMask = Mat::zeros(image.size(), CV_8UC1);
    std::vector<std::vector<Point>> bestContours = { bestContour };
    fillPoly(centralMask, bestContours, Scalar(255));

    // 取得最佳色塊邊界
    Rect bestBox = boundingRect(bestContour);

    // 稍微擴大框
    bestBox = Rect(bestBox.x - bestBox.width / 8, bestBox.y - bestBox.height / 8,
        bestBox.width + bestBox.width / 4, bestBox.height + bestBox.height / 4);

    return generateTriangleGrid(image, centralMask, bestBox, gridSize);
}

// 繪製網格
void drawGrid(Mat& image, std::vector<GridNode>& gridNodes) {
    for (const auto& node : gridNodes) {
        circle(image, Point(node.position.x, node.position.y), 4, Scalar(0, 255, 0, 255), FILLED);
        for (const auto& neighbor : node.neighbors) {
            line(image, Point(node.position.x, node.position.y),
                Point(neighbor->position.x, neighbor->position.y),
                Scalar(255, 0, 0, 255), 2);
        }
    }
}
std::vector<GridNode> gridNodes;
// 處理HTTP請求的回調函數
void http_handler(struct mg_connection* conn, int ev, void* ev_data, void* fn_data) {
    if (ev == MG_EV_HTTP_MSG) {
        struct mg_http_message* hm = (struct mg_http_message*)ev_data;

        // 處理根路徑請求 - 顯示HTML頁面
         if (mg_match(hm->uri, mg_str("/image"),NULL)) {
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
        } else if (mg_match(hm->uri, mg_str("/png2"), NULL)) {
            // 配置圖片路徑，這裡假設圖片名為 "image.jpg" 並位於當前目錄
            std::string image_path = "png.png";

            Mat readImageTest = imread("png.png", IMREAD_UNCHANGED);
            std::cout << " read image size: " << readImageTest.size() << std::endl;

            // 讀取圖片文件
            std::vector<char> content;
            if (read_file(image_path, content)) {
                // 獲取MIME類型
                std::string mime = get_mime_type(image_path);

                // 設置響應頭
                mg_printf(conn, "HTTP/1.1 200 OK\r\n"
                    "Content-Type: %s\r\n"
                    "Content-Length: %d\r\n\r\n",
                    mime.c_str(), (int)content.size());

                // 發送圖片數據
                mg_send(conn, content.data(), content.size());
            }
            else {
                // 如果無法讀取圖片，返回404錯誤
                mg_http_reply(conn, 404, "", "Image not found");
            }
        }
        else if (mg_match(hm->uri, mg_str("/png3"), NULL)) {
             // 配置圖片路徑，這裡假設圖片名為 "image.jpg" 並位於當前目錄
             std::string image_path = "png.png";

             Mat image = imread("png.png", IMREAD_UNCHANGED);
             std::cout << " read image size: " << image.size() << std::endl;

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
        else if (mg_match(hm->uri, mg_str("/png"), NULL)) {
             // 配置圖片路徑，這裡假設圖片名為 "image.jpg" 並位於當前目錄
             std::string image_path = "png.png";

             image = imread("png.png", IMREAD_UNCHANGED);
             std::cout << " read image size: " << image.size() << std::endl;
         
          
             gridNodes = extractGridPoints(image, 80);
             drawGrid(image, gridNodes);

             std::cout << " init grid point! " << std::endl;
             findNearestGridNodeOptimized(gridNodes, { 0,0 });
             std::vector<uchar> buffer;
             if (!imencode(".png", image, buffer)) {
                 mg_printf(conn, "HTTP/1.1 500 Internal Server Error\r\n"
                     "Content-Type: text/plain\r\n"
                     "Content-Length: 22\r\n\r\n"
                     "Failed to encode image");
                 return;
             }

             mg_printf(conn, "HTTP/1.1 200 OK\r\n"
                 "Content-Type: image/png\r\n"
                 "Content-Length: %d\r\n\r\n", (int)buffer.size());

             mg_send(conn, buffer.data(), buffer.size());
         }
        else if (mg_match(hm->uri, mg_str("/api/points"), NULL)) {

            std::string input(hm->body.buf);
            json data = json::parse(input);

            float x = data["x"];
            float cw = data["canvasWidth"];
            float y = data["y"];
            float ch = data["canvasHeight"];
            float _x = (x * (float)image.cols / cw) ;
            float _y = (y * (float)image.rows / ch) ;


            std::cout << " normalized x = " << _x << " , y = " << _y << std::endl;
            auto nearPoint=findNearestGridNodeOptimized(gridNodes, {(float)_x,(float)_y });
            
           
            json result;

            if (nearPoint == nullptr)
            {
                result["y"] = 0;
                result["x"] = 0;
            }
            else
            {
                result["y"] = nearPoint->position.y * ch /(float)image.rows;
                result["x"] = nearPoint->position.x * cw / (float)image.cols;
            }
            std::cout << " hi someone call api points ... "<<data <<"nearest is : "<<result<< std::endl;
            std::cout << " what's my size: " << image.rows << " , " << image.cols << std::endl;
           // mg_http_reply(conn, 200, "Content-Type: application/json\r\n", "{\"success\":true,\"message\":\"good\"}");
            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());

         }
        else if (mg_match(hm->uri, mg_str("/api/layer/save"), NULL)) {
             
             std::cout << " hi someong call me ... " << std::endl;

             mg_http_reply(conn, 200, "Content-Type: application/json\r\n", "{\"success\":true,\"message\":\"專案儲存成功\"}");

         }
        else if (mg_match(hm->uri, mg_str("/api/tool1"), NULL)) {

             if (mg_strcmp(hm->method, mg_str("POST")) != 0) {
                 mg_http_reply(conn, 405, "Content-Type: application/json\r\n", "{\"success\":false,\"message\":\"方法不允許，需要 POST 請求\"}");
                 return;
             }
             std::cout << " hi someong call me tool1 ... " << std::endl;

             mg_http_reply(conn, 200, "Content-Type: application/json\r\n", "{\"success\":true,\"message\":\"專案儲存成功\"}");

         }

        // 處理其他路徑請求 - 返回404錯誤
        else  {
             // Serve web root directory
             std::cout << " show html ... " << std::endl;
             struct mg_http_serve_opts opts = { 0 };
             opts.root_dir = ".";
             opts.ssi_pattern = "#.html";
             mg_http_serve_dir(conn, hm, &opts);
         }

    }
}

int main() {
    struct mg_mgr mgr;
    mg_mgr_init(&mgr);

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