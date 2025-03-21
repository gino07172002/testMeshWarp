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

#include "gameObject.h"
#include <unordered_set>
#include <functional>
#include "imgProc.h"

#include <thread>
#include <vector>
#include <mutex>
#include <atomic>
#include <functional>
//#include "gameObject.h"

using json = nlohmann::json;

using namespace cv;
using namespace std;
Mat image;
Mat image_post;
Mat debugMask;
Rect debugBox;
int selectIndex=-1; //select index of gridNode
GridNode* selectNode=nullptr;

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
bool triangleHasColor(const Mat& image, const Mat& centralMask, Point pt1, Point pt2, Point pt3) {
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


std::vector<Triangle*> g_triangles;
std::set<Triangle*, TriangleComparator> g_triangle_set;


void visualizeGridDeformation(const cv::Mat& inputImage) {
    // Create two images - one for original grid and one for deformed grid
    cv::Mat originalGrid = inputImage.clone();
    cv::Mat deformedGrid = inputImage.clone();

    // Define colors for visualization
    cv::Scalar triangleColor(0, 255, 0);  // Green for triangles
    cv::Scalar nodeColor(0, 0, 255);      // Red for nodes

    // Iterate through all triangles in the global set
    for (const Triangle* triangle : g_triangle_set) {
        if (!triangle->v1 || !triangle->v2 || !triangle->v3) {
            continue;  // Skip invalid triangles
        }

        // Draw original triangular grid
        std::vector<cv::Point> originalPoints = {
            cv::Point(static_cast<int>(triangle->v1->position.x), static_cast<int>(triangle->v1->position.y)),
            cv::Point(static_cast<int>(triangle->v2->position.x), static_cast<int>(triangle->v2->position.y)),
            cv::Point(static_cast<int>(triangle->v3->position.x), static_cast<int>(triangle->v3->position.y))
        };

        // Draw deformed triangular grid
        std::vector<cv::Point> deformedPoints = {
            cv::Point(static_cast<int>(triangle->v1->position_modified.x), static_cast<int>(triangle->v1->position_modified.y)),
            cv::Point(static_cast<int>(triangle->v2->position_modified.x), static_cast<int>(triangle->v2->position_modified.y)),
            cv::Point(static_cast<int>(triangle->v3->position_modified.x), static_cast<int>(triangle->v3->position_modified.y))
        };

        // Draw original triangle
        cv::polylines(originalGrid, originalPoints, true, triangleColor, 1);

        // Draw deformed triangle
        cv::polylines(deformedGrid, deformedPoints, true, triangleColor, 1);

        // Draw nodes (optional)
        for (const auto& point : originalPoints) {
            cv::circle(originalGrid, point, 3, nodeColor, -1);
        }

        for (const auto& point : deformedPoints) {
            cv::circle(deformedGrid, point, 3, nodeColor, -1);
        }
    }

    // Display results
    cv::imshow("Original Grid", originalGrid);
    cv::imshow("Deformed Grid", deformedGrid);
    cv::waitKey(0);
}

void applyGridDeformationToImage(const cv::Mat& inputImage, cv::Mat& outputImage) {
    // Start with a copy of the input image instead of a black image
    outputImage = inputImage.clone();

    // Track which pixels have been covered by triangles
    cv::Mat coveredMask = cv::Mat::zeros(inputImage.size(), CV_8UC1);

    // Process each triangle
    for (const Triangle* triangle : g_triangle_set) {
        if (!triangle->v1 || !triangle->v2 || !triangle->v3) {
            continue;  // Skip invalid triangles
        }

        // Original triangle vertices
        std::vector<cv::Point2f> srcTri = {
            triangle->v1->position,
            triangle->v2->position,
            triangle->v3->position
        };

        // Deformed triangle vertices
        std::vector<cv::Point2f> dstTri = {
            triangle->v1->position_modified,
            triangle->v2->position_modified,
            triangle->v3->position_modified
        };

        // Create a mask for the current triangle in its destination position
        cv::Mat triangleMask = cv::Mat::zeros(inputImage.size(), CV_8UC1);
        std::vector<cv::Point> points = {
            cv::Point(static_cast<int>(dstTri[0].x), static_cast<int>(dstTri[0].y)),
            cv::Point(static_cast<int>(dstTri[1].x), static_cast<int>(dstTri[1].y)),
            cv::Point(static_cast<int>(dstTri[2].x), static_cast<int>(dstTri[2].y))
        };
        cv::fillConvexPoly(triangleMask, points, cv::Scalar(255));

        // Compute the affine transformation
        cv::Mat warpMat = cv::getAffineTransform(srcTri.data(), dstTri.data());

        // Apply the transformation
        cv::Mat warpedImage;
        cv::warpAffine(inputImage, warpedImage, warpMat, inputImage.size(),
                      cv::INTER_LINEAR, cv::BORDER_TRANSPARENT);

        // Update only the pixels inside the destination triangle
        warpedImage.copyTo(outputImage, triangleMask);

        // Mark these pixels as covered
        cv::bitwise_or(coveredMask, triangleMask, coveredMask);
    }
}


void processAndDisplayDeformation(const cv::Mat& inputImage) {
    // Visualize the grid
    visualizeGridDeformation(inputImage);

    // Apply the deformation to the image
    cv::Mat deformedImage;
    applyGridDeformationToImage(inputImage, deformedImage);

    // Display the original and deformed images
    cv::imshow("Original Image", inputImage);
    cv::imshow("Deformed Image", deformedImage);
    cv::waitKey(0);
}



// 計算兩點之間的角度（相對於水平軸）
float calculateAngle(const cv::Point2f& center, const cv::Point2f& point) {
    return atan2(point.y - center.y, point.x - center.x);
}

// 計算三角形的內角
float calculateTriangleAngle(const cv::Point2f& p1, const cv::Point2f& p2, const cv::Point2f& p3) {
    // 計算向量
    cv::Point2f v1(p2.x - p1.x, p2.y - p1.y);
    cv::Point2f v2(p3.x - p1.x, p3.y - p1.y);

    // 計算向量的點積
    float dot = v1.x * v2.x + v1.y * v2.y;

    // 計算向量的模
    float mag1 = sqrt(v1.x * v1.x + v1.y * v1.y);
    float mag2 = sqrt(v2.x * v2.x + v2.y * v2.y);

    // 確保分母不為零
    if (mag1 * mag2 < 1e-6) {
        return 0.0f;
    }

    // 確保結果在有效範圍內
    float ratio = dot / (mag1 * mag2);
    ratio = std::max(-1.0f, std::min(1.0f, ratio));

    // 計算角度（弧度）
    float angle = acos(ratio);

    // 轉換為角度
    return angle * 180.0f / M_PI;
}

// 為節點構建三角形，可選參數minAngle用於篩選小角度三角形
void buildTrianglesForNode(GridNode& node, float maxAngle = 90.0f) {
    // 如果節點沒有足夠的鄰居來形成三角形，則直接返回
    if (node.neighbors.size() < 2) {
        return;
    }

    // 對鄰居節點按順時針排序
    std::vector<std::pair<float, GridNode*>> anglesWithNodes;
    for (GridNode* neighbor : node.neighbors) {
        float angle = calculateAngle(node.position, neighbor->position);
        anglesWithNodes.push_back(std::make_pair(angle, neighbor));
    }

    // 按角度排序（順時針）
    std::sort(anglesWithNodes.begin(), anglesWithNodes.end(),
              [](const std::pair<float, GridNode*>& a, const std::pair<float, GridNode*>& b) {
        return a.first > b.first;
    });

    // 從排序後的結果中提取節點
    std::vector<GridNode*> sortedNeighbors;
    for (const auto& pair : anglesWithNodes) {
        sortedNeighbors.push_back(pair.second);
    }

    // 為相鄰的鄰居創建三角形
    for (size_t i = 0; i < sortedNeighbors.size(); ++i) {
        GridNode* n1 = sortedNeighbors[i];
        GridNode* n2 = sortedNeighbors[(i + 1) % sortedNeighbors.size()];

        // 檢查最小角度條件
        if (maxAngle > 0.0f) {
            float angle1 = calculateTriangleAngle(node.position, n1->position, n2->position);
            float angle2 = calculateTriangleAngle(n1->position, node.position, n2->position);
            float angle3 = calculateTriangleAngle(n2->position, n1->position, node.position);

            if (angle1 > maxAngle || angle2 > maxAngle || angle3 > maxAngle) {
                continue;
            }
        }

        // 創建臨時三角形用於查找
        Triangle tempTriangle(&node, n1, n2);

        // 檢查三角形是否已存在於集合中
        bool exists = false;
        for (const Triangle* tri : g_triangle_set) {
            std::vector<GridNode*> triVertices = {tri->v1, tri->v2, tri->v3};
            std::vector<GridNode*> tempVertices = {tempTriangle.v1, tempTriangle.v2, tempTriangle.v3};

            std::sort(triVertices.begin(), triVertices.end());
            std::sort(tempVertices.begin(), tempVertices.end());

            if (triVertices[0] == tempVertices[0] &&
                    triVertices[1] == tempVertices[1] &&
                    triVertices[2] == tempVertices[2]) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            // 創建新三角形
            Triangle* triangle = new Triangle(&node, n1, n2);

            // 添加到集合和向量
            g_triangle_set.insert(triangle);
            g_triangles.push_back(triangle);

            // 添加到頂點的三角形列表中
            node.triangles.push_back(triangle);
            n1->triangles.push_back(triangle);
            n2->triangles.push_back(triangle);
        }
    }
}
// 生成三角形網格
std::vector<GridNode> generateTriangleGrid(const cv::Mat& image, const cv::Mat& centralMask,
                                           cv::Rect region, int gridSize) {
    std::vector<GridNode> gridNodes;
    int dx = gridSize;
    int dy = gridSize * sqrt(3) / 2;  // 正三角形高度

    int rows = region.height / dy ;
    int cols = region.width / dx  ;

    // 1. **建立所有網格節點**
    for (int row = 0; row <= rows; row++) {
        for (int col = 0; col <= cols; col++) {
            float x = region.x + col * dx + (row % 2) * (dx / 2);
            float y = region.y + row * dy;
            GridNode node;
            node.position = cv::Point2f(x, y);
            node.position_modified = cv::Point2f(x, y);
            gridNodes.push_back(node);
        }
    }

    int totalCols = cols + 1;

    // 2. **建立鄰接關係**
    for (size_t i = 0; i < gridNodes.size(); i++) {
        int row = i / totalCols;
        int col = i % totalCols;

        if (col > 0) gridNodes[i].neighbors.push_back(&gridNodes[i - 1]); // 左
        if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i + 1]); // 右

        if (row > 0) {
            if (row % 2 == 0) {
                if (col > 0) gridNodes[i].neighbors.push_back(&gridNodes[i - totalCols - 1]); // 左上
                if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i - totalCols]); // 右上
            } else {
                gridNodes[i].neighbors.push_back(&gridNodes[i - totalCols]); // 左上
                if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i - totalCols + 1]); // 右上
            }
        }

        if (row < rows) {
            if (row % 2 == 0) {
                if (col > 0) gridNodes[i].neighbors.push_back(&gridNodes[i + totalCols - 1]); // 左下
                if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i + totalCols]); // 右下
            } else {
                gridNodes[i].neighbors.push_back(&gridNodes[i + totalCols]); // 左下
                if (col < totalCols - 1) gridNodes[i].neighbors.push_back(&gridNodes[i + totalCols + 1]); // 右下
            }
        }
    }

    // 3. **篩選有效節點**
    std::vector<GridNode> validNodes;
    /*
    std::vector<bool> isValid(gridNodes.size(), false);

    // 檢查哪些節點應該保留
    for (size_t i = 0; i < gridNodes.size(); i++) {
        int row = i / totalCols;
        int col = i % totalCols;
        cv::Point2f pt = gridNodes[i].position;

        // 檢查三角形
        std::vector<cv::Point2f> candidateTriangles;

        if (row < rows && col < cols) {
            cv::Point2f pt2, pt3;
            if (row % 2 == 0) {
                pt2 = { pt.x + dx, pt.y };
                pt3 = { pt.x + dx / 2, pt.y + dy };
            } else {
                pt2 = { pt.x + dx, pt.y };
                pt3 = { pt.x - dx / 2, pt.y + dy };
            }

            if (triangleHasColor(image, centralMask, pt, pt2, pt3)) {
                isValid[i] = true;
            }
        }

        if (row > 0 && col < cols) {
            cv::Point2f pt2, pt3;
            if (row % 2 == 0) {
                pt2 = { pt.x + dx, pt.y };
                pt3 = { pt.x + dx / 2, pt.y - dy };
            } else {
                pt2 = { pt.x + dx, pt.y };
                pt3 = { pt.x + 1.5f * dx, pt.y - dy };
            }

            if (triangleHasColor(image, centralMask, pt, pt2, pt3)) {
                isValid[i] = true;
            }
        }
    }
*/
    // 4. **建立有效節點**
    for (size_t i = 0; i < gridNodes.size(); i++) {
        //if (isValid[i])
        {
            validNodes.push_back(gridNodes[i]);
        }
    }

    // 5. **重建有效節點的鄰接關係**
    for (auto& node : validNodes) {
        std::vector<GridNode*> validNeighbors;
        for (auto* neighbor : node.neighbors) {
            for (auto& validNode : validNodes) {
                if (cv::norm(validNode.position - neighbor->position) < 0.1) {
                    validNeighbors.push_back(&validNode);
                    break;
                }
            }
        }
        node.neighbors = validNeighbors;
    }

    // 6. **建立三角形**
    for (auto& node : validNodes) {
        buildTrianglesForNode(node);
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

    debugMask=centralMask.clone();
    // 取得最佳色塊邊界
    Rect bestBox = boundingRect(bestContour);

    // 稍微擴大框
    bestBox = Rect(bestBox.x - bestBox.width / 8, bestBox.y - bestBox.height / 8,
                   bestBox.width + bestBox.width / 4, bestBox.height + bestBox.height / 4);
    rectangle(debugMask,bestBox,Scalar(125,125,125),4);
    debugBox=bestBox;
    return generateTriangleGrid(image, centralMask, bestBox, gridSize);
}

// 繪製網格
void drawGrid(Mat& image, std::vector<GridNode>& gridNodes) {

    for (const auto& node : gridNodes) {
        circle(image, Point(node.position_modified.x, node.position_modified.y), 4, Scalar(0, 255, 0, 255), FILLED);
        for (const auto& neighbor : node.neighbors) {
            line(image, Point(node.position.x, node.position.y),
                 Point(neighbor->position_modified.x, neighbor->position_modified.y),
                 Scalar(255, 0, 0, 255), 2);
        }
    }
}

void drawGrid(cv::Mat& image, const std::set<Triangle*, TriangleComparator>& triangle_set) {
    // 遍歷所有的三角形
    for (const auto& triangle : triangle_set) {
        // 獲取三角形的三個頂點
        cv::Point2f p1 = triangle->v1->position_modified;
        cv::Point2f p2 = triangle->v2->position_modified;
        cv::Point2f p3 = triangle->v3->position_modified;

        // 定義三角形的頂點陣列
        std::vector<cv::Point> triangle_points = {
            cv::Point(static_cast<int>(p1.x), static_cast<int>(p1.y)),
            cv::Point(static_cast<int>(p2.x), static_cast<int>(p2.y)),
            cv::Point(static_cast<int>(p3.x), static_cast<int>(p3.y))
        };

        // 如果需要繪製三角形的邊框，可以使用 polylines
        const cv::Scalar border_color(255, 0, 0,255); // 藍色
        cv::polylines(image, std::vector<std::vector<cv::Point>>{triangle_points}, true, border_color, 2);
    }


}

std::vector<GridNode> gridNodes;
void updateImagePost(bool cloneOriginImage=true)
{
    if(cloneOriginImage)
        image_post=image.clone();
    drawGrid(image_post, g_triangle_set);
    rectangle(image_post,debugBox,Scalar(125,0,125,255),4);
}
Point srcImagePosition(double x,double y,double w,double h)
{
    double x2 = x * (double)image.cols / w;
    double y2 = y * (double)image.rows / h;
    return Point(x2,y2);
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
        else if (mg_match(hm->uri, mg_str("/pngDebug"), NULL)) {
            // 配置圖片路徑，這裡假設圖片名為 "image.jpg" 並位於當前目錄

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
        }else if (mg_match(hm->uri, mg_str("/maskDebug"), NULL)) {
            // 配置圖片路徑，這裡假設圖片名為 "image.jpg" 並位於當前目錄

            std::vector<uchar> buffer;
            if (!imencode(".png", debugMask, buffer)) {
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


            std::vector<uchar> buffer;
            if (!imencode(".png", image_post, buffer)) {
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
            Point srcPoint= srcImagePosition(x,y,w,h);
            circle(image_post, srcPoint, 10, Scalar(255, 255, 0, 255), FILLED);
            auto nearPoint = findNearestGridNodeOptimized(gridNodes, { (float)srcPoint.x,(float)srcPoint.y });

            Point nearPointCv(nearPoint->position.x,nearPoint->position.y);

            double distance = cv::norm(nearPointCv - srcPoint);

            if(distance<20)
            {
                selectNode=nearPoint;
                std::cout << " I would draw a near point at : " << nearPoint->position.x << " , " << nearPoint->position.y << std::endl;
                circle(image_post, Point(nearPoint->position.x, nearPoint->position.y), 10, Scalar(0, 255, 255, 255), FILLED);


                std::cout<<" select node : "<<selectNode->position.x<<" , "<<selectNode->position.y<<std::endl;

                std::cout<<" select node neighbor : "<<selectNode->neighbors.size()<<" , triangle : "<<selectNode->triangles.size()<<std::endl;
                for(auto& tri : selectNode->triangles)
                {
                    std::cout<<" tri points : "<<tri->v1->position<<" , "<<tri->v2->position<<" , "<<tri->v3->position<<std::endl;


                }
                std::cout<<"total triangle set : "<<g_triangle_set.size()<<std::endl;

            }
            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());

        }
        else if (mg_match(hm->uri, mg_str("/api/drag"), NULL)) {


            std::string input(hm->body.buf);
            json data = json::parse(input);

            // std::cout << " dragging ~" <<data<< std::endl;
            json result;
            result["success"] = true;
            result["message"] = "good";
            double x = data["x"];
            double y = data["y"];
            double w = data["scw"];
            double h = data["sch"];
            if(selectNode)
            {
                Point srcPoint= srcImagePosition(x,y,w,h);
                selectNode->position_modified.x=srcPoint.x;
                selectNode->position_modified.y=srcPoint.y;
                //   circle(image_post, Point(selectNode->position_modified.x, selectNode->position_modified.y), 10, Scalar(0,255, 255, 255), FILLED);

                std::cout<<" let's doing deform ... "<<std::endl;

                applyGridDeformationToImage(image,image_post);
                updateImagePost(false);
                // cv::Mat deformed = deformImageWithGrid(gridNodes, image,image.rows, image.cols);

                std::cout<<"deform done ... "<<std::endl;
            }
            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());

        } else if (mg_match(hm->uri, mg_str("/api/dragDone"), NULL)) {


            std::cout<<" hi drag done ... "<<std::endl;
            std::string input(hm->body.buf);
            json data = json::parse(input);

            // std::cout << " dragging ~" <<data<< std::endl;
            json result;
            result["success"] = true;
            result["message"] = "good";
            if(selectNode)
            {
                std::cout<<" let's doing deform ... "<<std::endl;

                applyGridDeformationToImage(image,image_post);
                updateImagePost(false);
                // cv::Mat deformed = deformImageWithGrid(gridNodes, image,image.rows, image.cols);

                std::cout<<"deform done ... "<<std::endl;
                selectNode=nullptr;
            }
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



int main() {
    std::cout << " go go hh ..." << std::endl;


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
    image_post=image.clone();
    gridNodes = extractGridPoints(image, 80);
    updateImagePost();

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
