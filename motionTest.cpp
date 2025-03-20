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
#include "gameObject.h"
#include <unordered_set>
#include <functional>
//#include "gameObject.h"

using json = nlohmann::json;

using namespace cv;
using namespace std;
Mat image;

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
        else if (mg_match(hm->uri, mg_str("/png2"), NULL)) {
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
            std::string image_path = "png.png";

            std::vector<uchar> buffer;
            if (!imencode(".png", image, buffer)) {
                mg_http_reply(conn, 500, "Content-Type: application/json\r\n",
                    "{\"error\": \"Failed to encode image\"}");
                return;
            }

            // 將圖片轉換為base64
            std::string base64_image = base64_encode(buffer.data(), buffer.size());

            // 回傳JSON格式，包含base64圖片和時間戳記
            std::string response = "{\"image\": \"data:image/png;base64," + base64_image +
                "\", \"timestamp\": " + std::to_string(time(NULL)) + "}";

            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", "%s", response.c_str());
        }
        else if (mg_match(hm->uri, mg_str("/api/points"), NULL)) {

            std::cout << " hello ~" << std::endl;
            std::string input(hm->body.buf);
            json data = json::parse(input);
            json result;
            result["success"] = true;
            result["message"] = "good";
            std::cout << " hi input :" << input << endl;


            double x = data["x"];
            double y = data["y"];
            double w = data["scw"];
            double h = data["sch"];

            std::cout << " what's my size: " << image.rows << " , " << image.cols << std::endl;
            double x2 = x * (double)image.cols / w;
            double y2 = y * (double)image.rows / h;
            circle(image, Point(x2, y2), 10, Scalar(255, 255, 0, 255), FILLED);
            auto nearPoint = findNearestGridNodeOptimized(gridNodes, { (float)x2,(float)y2 });

            std::cout << " I would draw a near point at : " << nearPoint->position.x << " , " << nearPoint->position.y << std::endl;
            circle(image, Point(nearPoint->position.x, nearPoint->position.y), 10, Scalar(0, 255, 255, 255), FILLED);




            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());

        }
        else if (mg_match(hm->uri, mg_str("/api/drag"), NULL)) {

            std::cout << " dragging ~" << std::endl;
            std::string input(hm->body.buf);
            json data = json::parse(input);
            json result;
            result["success"] = true;
            result["message"] = "good";
            


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
        else {
            // Serve web root directory
            std::cout << " show html ... " << std::endl;
            struct mg_http_serve_opts opts = { 0 };
            opts.root_dir = ".";
            opts.ssi_pattern = "#.html";
            mg_http_serve_dir(conn, hm, &opts);
        }

    }
}



namespace {
    // 三角形哈希結構
    struct TriangleHash {
        std::size_t operator()(const std::tuple<const GridNode*,
            const GridNode*,
            const GridNode*>& tri) const {
            auto hash1 = std::hash<const GridNode*>{}(std::get<0>(tri));
            auto hash2 = std::hash<const GridNode*>{}(std::get<1>(tri));
            auto hash3 = std::hash<const GridNode*>{}(std::get<2>(tri));
            return hash1 ^ (hash2 << 1) ^ (hash3 << 2);
        }
    };

    // 三角形比較結構
    struct TriangleEqual {
        bool operator()(const std::tuple<const GridNode*, const GridNode*, const GridNode*>& lhs,
            const std::tuple<const GridNode*, const GridNode*, const GridNode*>& rhs) const {
            return std::tie(std::get<0>(lhs), std::get<1>(lhs), std::get<2>(lhs)) ==
                std::tie(std::get<0>(rhs), std::get<1>(rhs), std::get<2>(rhs));
        }
    };
}

cv::Mat deformImageWithGrid(const std::vector<GridNode>& grid,
    const cv::Mat& image,
    int rows,
    int cols) {
    cv::Mat dst = cv::Mat::zeros(image.size(), image.type());
    std::unordered_set<std::tuple<const GridNode*, const GridNode*, const GridNode*>,
        TriangleHash,
        TriangleEqual> processedTriangles;

    // 生成並處理三角形
    for (int i = 0; i < rows - 1; ++i) {
        for (int j = 0; j < cols - 1; ++j) {
            const GridNode* tl = &grid[i * cols + j];
            const GridNode* tr = &grid[i * cols + (j + 1)];
            const GridNode* bl = &grid[(i + 1) * cols + j];
            const GridNode* br = &grid[(i + 1) * cols + (j + 1)];

            std::array trianglesToProcess = {
                std::make_tuple(tl, tr, br),
                std::make_tuple(tl, br, bl)
            };

            for (auto& tri : trianglesToProcess) {
                // 對頂點進行排序以保證唯一性
                auto sortedTri = [&]() -> std::tuple<const GridNode*, const GridNode*, const GridNode*> {
                    const GridNode* arr[3] = { std::get<0>(tri), std::get<1>(tri), std::get<2>(tri) };
                    std::sort(arr, arr + 3, [](const GridNode* a, const GridNode* b) {
                        return a < b;
                        });
                    return std::make_tuple(arr[0], arr[1], arr[2]);
                    }();

                // 檢查是否已處理過
                if (processedTriangles.find(sortedTri) != processedTriangles.end()) {
                    continue;
                }

                // 記錄已處理三角形
                processedTriangles.insert(sortedTri);

                // 獲取頂點坐標
                std::vector<cv::Point2f> src_pts = {
                    {std::get<0>(sortedTri)->position.x, std::get<0>(sortedTri)->position.y},
                    {std::get<1>(sortedTri)->position.x, std::get<1>(sortedTri)->position.y},
                    {std::get<2>(sortedTri)->position.x, std::get<2>(sortedTri)->position.y}
                };

                std::vector<cv::Point2f> dst_pts = {
                    {std::get<0>(sortedTri)->position_modified.x, std::get<0>(sortedTri)->position_modified.y},
                    {std::get<1>(sortedTri)->position_modified.x, std::get<1>(sortedTri)->position_modified.y},
                    {std::get<2>(sortedTri)->position_modified.x, std::get<2>(sortedTri)->position_modified.y}
                };

                // 計算仿射變換
                cv::Mat M = cv::getAffineTransform(src_pts, dst_pts);

                // 計算變換後的邊界框並限制在圖像範圍內
                cv::Rect bbox = cv::boundingRect(dst_pts);
                cv::Rect validRect(0, 0, image.cols, image.rows);
                bbox &= validRect; // 關鍵修復：限制邊界框在圖像範圍內

                if (bbox.empty()) continue; // 跳過無效區域

                // 創建掩碼
                cv::Mat mask(image.size(), CV_8UC1, cv::Scalar(0));
                std::vector<cv::Point> pts = { src_pts[0], src_pts[1], src_pts[2] };
                cv::fillConvexPoly(mask, pts, cv::Scalar(255));

                // 應用變換
                cv::Mat warped, mask_warped;
                cv::warpAffine(image, warped, M, image.size(),
                    cv::INTER_LINEAR, cv::BORDER_CONSTANT, cv::Scalar(0));
                cv::warpAffine(mask, mask_warped, M, image.size(),
                    cv::INTER_NEAREST, cv::BORDER_CONSTANT, cv::Scalar(0));

                // 獲取有效ROI區域
                cv::Mat dst_roi = dst(bbox);
                cv::Mat warped_roi = warped(bbox);
                cv::Mat mask_roi = mask_warped(bbox);

                // 執行拷貝（添加額外檢查）
                if (warped_roi.size() == mask_roi.size() &&
                    dst_roi.size() == mask_roi.size()) {
                    warped_roi.copyTo(dst_roi, mask_roi);
                }
            }
        }
    }

    return dst;
}

void drawGrid(const std::vector<GridNode>& grid,
    int rows, int cols,
    cv::Mat& image,
    bool useModified = false,
    const cv::Scalar& color = cv::Scalar(0, 255, 0)) {
    for (int i = 0; i < rows - 1; ++i) {
        for (int j = 0; j < cols - 1; ++j) {
            const GridNode* tl = &grid[i * cols + j];
            const GridNode* tr = &grid[i * cols + (j + 1)];
            const GridNode* bl = &grid[(i + 1) * cols + j];
            const GridNode* br = &grid[(i + 1) * cols + (j + 1)];

            // 獲取坐標
            myPoint p_tl = useModified ? tl->position_modified : tl->position;
            myPoint p_tr = useModified ? tr->position_modified : tr->position;
            myPoint p_bl = useModified ? bl->position_modified : bl->position;
            myPoint p_br = useModified ? br->position_modified : br->position;

            // 繪製四邊形邊
            cv::line(image, cv::Point(p_tl.x, p_tl.y), cv::Point(p_tr.x, p_tr.y), color, 1);
            cv::line(image, cv::Point(p_tr.x, p_tr.y), cv::Point(p_br.x, p_br.y), color, 1);
            cv::line(image, cv::Point(p_br.x, p_br.y), cv::Point(p_bl.x, p_bl.y), color, 1);
            cv::line(image, cv::Point(p_bl.x, p_bl.y), cv::Point(p_tl.x, p_tl.y), color, 1);

            // 繪製對角線
            cv::line(image, cv::Point(p_tl.x, p_tl.y), cv::Point(p_br.x, p_br.y), color, 1);
            cv::line(image, cv::Point(p_tr.x, p_tr.y), cv::Point(p_bl.x, p_bl.y), color, 1);
        }
    }
}

int main2() {
    // 讀取輸入圖像
    cv::Mat image = cv::imread("image.jpg");
    if (image.empty()) {
        std::cerr << "Could not open image!" << std::endl;
        return -1;
    }

    // 網格參數
    int rows = 5, cols = 5;
    float width = image.cols;
    float height = image.rows;
    float dx = width / (cols - 1);
    float dy = height / (rows - 1);

    // 創建網格
    std::vector<GridNode> grid(rows * cols);
    for (int i = 0; i < rows; ++i) {
        for (int j = 0; j < cols; ++j) {
            GridNode& node = grid[i * cols + j];
            node.position = { j * dx, i * dy };
            node.position_modified = node.position; // 初始位置相同
        }
    }

    // 設置鄰居關係（上下左右）
    for (int i = 0; i < rows; ++i) {
        for (int j = 0; j < cols; ++j) {
            GridNode& node = grid[i * cols + j];
            if (i > 0) node.neighbors.push_back(&grid[(i - 1) * cols + j]);
            if (i < rows - 1) node.neighbors.push_back(&grid[(i + 1) * cols + j]);
            if (j > 0) node.neighbors.push_back(&grid[i * cols + (j - 1)]);
            if (j < cols - 1) node.neighbors.push_back(&grid[i * cols + (j + 1)]);
        }
    }

    // 修改中心節點位置
    int centerIdx = (rows / 2) * cols + (cols / 2);
    grid[centerIdx].position_modified.y -= 50; // 向上移動50像素

    // 執行變形
    cv::Mat deformed = deformImageWithGrid(grid, image, rows, cols);

    // 顯示結果

    // 創建調試圖像
    cv::Mat debugOriginal = image.clone();
    cv::Mat debugDeformed = deformed.clone();

    // 繪製網格
    drawGrid(grid, rows, cols, debugOriginal, false, cv::Scalar(0, 255, 0)); // 原始網格綠色
    drawGrid(grid, rows, cols, debugDeformed, true, cv::Scalar(0, 0, 255));  // 變形網格紅色

    // 顯示結果
    cv::imshow("Original with Grid", debugOriginal);
    cv::imshow("Deformed with Grid", debugDeformed);

    cv::imshow("Original", image);
    cv::imshow("Deformed", deformed);
    cv::waitKey(0);

    return 0;
}


int main() {
    std::cout << " go go ..." << std::endl;


    auto root = GameObject::Create("Root");
    auto child1 = GameObject::Create("Child1");
    auto child2 = GameObject::Create("Child2");
    auto grandChild = Bone::Create("GrandChild");

    // Establish object relationships
    root->AddChild(child1);
    root->AddChild(child2);
    child1->AddChild(grandChild);

    // Get nested JSON
    json hierarchyJson = root->GetHierarchyJson();

    std::cout << "Hierarchy JSON:\n" << hierarchyJson.dump(4) << std::endl;


    struct mg_mgr mgr;
    mg_mgr_init(&mgr);

    image = imread("png.png", IMREAD_UNCHANGED);
    gridNodes = extractGridPoints(image, 80);
    drawGrid(image, gridNodes);

    std::cout << " init grid point! " << std::endl;
    findNearestGridNodeOptimized(gridNodes, { 0,0 });
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