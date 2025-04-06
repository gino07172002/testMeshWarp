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
UMat image_show;
UMat debugMask;
Rect debugBox;
int selectIndex = -1; //select index of gridNode
GridNode* selectNode = nullptr;
int controlMode = 0; // 0 : grabbing , 1 : bone
Point firstClick;
Point secondClick;


struct AppState {
    vector<Bone> bones;
    Bone* selectedBone = nullptr;
    Point dragStart;
    Point originalHead;
    Point originalTail;
    Point rotateCenter;
    double initialAngle;

    enum Mode { NONE, DRAG_HEAD, DRAG_TAIL, TRANSLATE, ROTATE } mode = NONE;
};
AppState state;
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
GridNode* findNearestGridNodeOptimized(const std::vector<GridNode>& gridNodes, const cv::Point& targetPoint) {
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
std::set<Triangle*, TriangleComparator> select_triangle_set;
std::vector<GridNode> gridNodes;


void applyGridDeformationToImage(const cv::UMat& inputImage, cv::UMat& outputImage,
                                 const std::set<Triangle*, TriangleComparator>& triangles) {
    cv::TickMeter totalTimer, prepTimer, mapTimer, fillTimer, remapTimer, mergeTimer;
    totalTimer.start();
    // 創建 UMat 映射表
    cv::UMat map_x(inputImage.size(), CV_32FC1);
    cv::UMat map_y(inputImage.size(), CV_32FC1);

    // 轉換為 Mat 以進行像素級操作
    cv::Mat map_x_mat = map_x.getMat(cv::ACCESS_RW);
    cv::Mat map_y_mat = map_y.getMat(cv::ACCESS_RW);

    // 初始化映射
    for (int y = 0; y < inputImage.rows; y++) {
        for (int x = 0; x < inputImage.cols; x++) {
            map_x_mat.at<float>(y, x) = static_cast<float>(x);
            map_y_mat.at<float>(y, x) = static_cast<float>(y);
        }
    }

    // 遍歷每個三角形並計算仿射變換
    for (const auto& tri : triangles) {
        std::vector<cv::Point2f> src = tri->getModifiedPoints();
        std::vector<cv::Point2f> dst = tri->getOriginalPoints();

        // 計算仿射變換矩陣
        cv::Mat warpMat = cv::getAffineTransform(src, dst);

        // 取得三角形邊界框
        cv::Rect boundingBox = cv::boundingRect(src);

        // 遍歷三角形範圍內的像素
        for (int y = boundingBox.y; y < boundingBox.y + boundingBox.height; y++) {
            for (int x = boundingBox.x; x < boundingBox.x + boundingBox.width; x++) {
                cv::Point2f pt(static_cast<float>(x), static_cast<float>(y));

                // 確保點位於三角形內
                if (cv::pointPolygonTest(src, pt, false) >= 0) {
                    // 變換點
                    cv::Mat srcPt = (cv::Mat_<double>(3, 1) << x, y, 1);
                    cv::Mat dstPt = warpMat * srcPt;

                    // 更新映射表
                    map_x_mat.at<float>(y, x) = static_cast<float>(dstPt.at<double>(0, 0));
                    map_y_mat.at<float>(y, x) = static_cast<float>(dstPt.at<double>(1, 0));
                }
            }
        }
    }

    // 將變更的 Mat 回寫回 UMat
    map_x = map_x_mat.getUMat(cv::ACCESS_READ);
    map_y = map_y_mat.getUMat(cv::ACCESS_READ);

    // 使用 OpenCL 加速 remap
    cv::remap(inputImage, outputImage, map_x, map_y, cv::INTER_LINEAR);
    totalTimer.stop();
    //std::cout << "總執行時間: " << totalTimer.getTimeMilli() << " ms\n" << std::endl;

}
/*
void applyGridDeformationToImage(const cv::UMat& inputImage, cv::UMat& outputImage, const std::set<Triangle*, TriangleComparator>& triangles) {
    cv::TickMeter totalTimer, prepTimer, mapTimer, fillTimer, remapTimer, mergeTimer;
    totalTimer.start();
    //inputImage.copyTo(outputImage);

    for (const auto& tri : triangles) {
        // 获取原始顶点和变形后的顶点
        std::vector<cv::Point2f> dstPts = {
            tri->v1->position,
            tri->v2->position,
            tri->v3->position
        };
        std::vector<cv::Point2f> srcPts = {
            tri->v1->position_modified,
            tri->v2->position_modified,
            tri->v3->position_modified
        };

        // 计算仿射变换矩阵（注意：OpenCV需要逆矩阵）
        cv::Mat M_forward = cv::getAffineTransform(srcPts, dstPts);
        cv::Mat M_inverse = cv::getAffineTransform(dstPts, srcPts);

        // 创建掩码（变形后的三角形区域）
        cv::UMat mask(inputImage.size(), CV_8UC1, cv::Scalar(0));
        std::vector<cv::Point> dstPtsInt;
        for (const auto& pt : dstPts) {
            dstPtsInt.emplace_back(cv::Point(cvRound(pt.x), cvRound(pt.y)));
        }
        cv::fillConvexPoly(mask, dstPtsInt, cv::Scalar(255));

        // 应用仿射变换（使用逆矩阵进行反向映射）
        cv::UMat temp;
        cv::warpAffine(inputImage, temp, M_inverse, inputImage.size(),
            cv::INTER_LINEAR, cv::BORDER_TRANSPARENT, cv::Scalar(0));

        // 将变换后的区域合并到输出图像
        temp.copyTo(outputImage, mask);  // 这里使用 mask 限定作用区域
    }
    totalTimer.stop();
    std::cout << "總執行時間: " << totalTimer.getTimeMilli() << " ms\n" << std::endl;
}
*/
/*
void applyGridDeformationToImage(const cv::UMat& inputImage, cv::UMat& outputImage, std::set<Triangle*, TriangleComparator> triangles) {
    cv::TickMeter totalTimer, prepTimer, mapTimer, fillTimer, remapTimer, mergeTimer;
    totalTimer.start();

    // 確保OpenCL已啟用
    cv::ocl::setUseOpenCL(true);

    // 預先分配記憶體
    inputImage.copyTo(outputImage);
    cv::UMat accumulatedMask = cv::UMat::zeros(inputImage.size(), CV_8UC1);

    // 預先過濾有效三角形
    std::vector<Triangle*> validTriangles;
    validTriangles.reserve(triangles.size());
    for (Triangle* triangle : triangles) {
        if (triangle->v1 && triangle->v2 && triangle->v3) {
            validTriangles.push_back(triangle);
        }
    }

    const int BATCH_SIZE = 100;
    for (size_t batchStart = 0; batchStart < validTriangles.size(); batchStart += BATCH_SIZE) {
        size_t batchEnd = std::min(batchStart + BATCH_SIZE, validTriangles.size());
        size_t batchSize = batchEnd - batchStart;

        // 批次處理的遮罩和結果
        cv::UMat batchMask = cv::UMat::zeros(inputImage.size(), CV_8UC1);
        cv::UMat batchResult = cv::UMat::zeros(inputImage.size(), inputImage.type());

        // 對批次中的每個三角形進行處理
        for (size_t i = batchStart; i < batchEnd; i++) {
            Triangle* triangle = validTriangles[i];

            prepTimer.start();
            // 源三角形頂點 (原始位置)
            std::vector<cv::Point2f> srcTriangle = {
                triangle->v1->position,
                triangle->v2->position,
                triangle->v3->position
            };

            // 目標三角形頂點 (修改後位置)
            std::vector<cv::Point2f> dstTriangle = {
                triangle->v1->position_modified,
                triangle->v2->position_modified,
                triangle->v3->position_modified
            };

            // 將目標三角形轉換為整數點，用於填充多邊形
            std::vector<cv::Point> dstTriangleInt = {
                cv::Point(static_cast<int>(dstTriangle[0].x), static_cast<int>(dstTriangle[0].y)),
                cv::Point(static_cast<int>(dstTriangle[1].x), static_cast<int>(dstTriangle[1].y)),
                cv::Point(static_cast<int>(dstTriangle[2].x), static_cast<int>(dstTriangle[2].y))
            };

            // 計算目標三角形的邊界框
            int minX = INT_MAX, minY = INT_MAX, maxX = 0, maxY = 0;
            for (const auto& pt : dstTriangleInt) {
                minX = std::min(minX, pt.x);
                minY = std::min(minY, pt.y);
                maxX = std::max(maxX, pt.x);
                maxY = std::max(maxY, pt.y);
            }

            // 確保邊界框在圖像範圍內
            minX = std::max(0, minX);
            minY = std::max(0, minY);
            maxX = std::min(inputImage.cols - 1, maxX);
            maxY = std::min(inputImage.rows - 1, maxY);

            // 確保邊界框有效
            if (maxX <= minX || maxY <= minY) continue;

            cv::Rect roi(minX, minY, maxX - minX + 1, maxY - minY + 1);
            prepTimer.stop();

            // 計算仿射矩陣 (從目標到源，與getAffineTransform相反)
            cv::Mat affine = cv::getAffineTransform(dstTriangle, srcTriangle);

            // 為ROI創建映射坐標
            mapTimer.start();
            cv::UMat mapX(roi.height, roi.width, CV_32F);
            cv::UMat mapY(roi.height, roi.width, CV_32F);

            // 需要將remap映射中的坐標計算移至CPU端進行
            // 因為UMat不支持直接使用.at操作和算術運算
            cv::Mat mapX_cpu(roi.height, roi.width, CV_32F);
            cv::Mat mapY_cpu(roi.height, roi.width, CV_32F);

            // 使用仿射矩陣計算每個像素的映射
            for (int y = 0; y < roi.height; y++) {
                float* mapX_row = mapX_cpu.ptr<float>(y);
                float* mapY_row = mapY_cpu.ptr<float>(y);

                for (int x = 0; x < roi.width; x++) {
                    float srcX = static_cast<float>(x + roi.x);
                    float srcY = static_cast<float>(y + roi.y);

                    // 計算反向映射 (從目標到源)
                    mapX_row[x] = static_cast<float>(affine.at<double>(0, 0) * srcX +
                        affine.at<double>(0, 1) * srcY +
                        affine.at<double>(0, 2));

                    mapY_row[x] = static_cast<float>(affine.at<double>(1, 0) * srcX +
                        affine.at<double>(1, 1) * srcY +
                        affine.at<double>(1, 2));
                }
            }

            // 將計算結果上傳到GPU
            mapX_cpu.copyTo(mapX);
            mapY_cpu.copyTo(mapY);
            mapTimer.stop();

            // 創建三角形遮罩
            fillTimer.start();
            cv::UMat mask = cv::UMat::zeros(roi.size(), CV_8UC1);
            std::vector<cv::Point> shiftedTriangle;
            for (const auto& pt : dstTriangleInt) {
                shiftedTriangle.push_back(cv::Point(pt.x - roi.x, pt.y - roi.y));
            }
            cv::fillConvexPoly(mask, shiftedTriangle, cv::Scalar(255), cv::LINE_8);
            fillTimer.stop();

            // 對ROI應用remap操作
            remapTimer.start();
            cv::UMat roiResult;
            cv::remap(inputImage, roiResult, mapX, mapY, cv::INTER_CUBIC, cv::BORDER_TRANSPARENT);

            // 將變換結果與遮罩合併到批次結果
            cv::UMat maskedResult;
            cv::bitwise_and(roiResult, roiResult, maskedResult, mask);

            // 更新批次結果和遮罩
            cv::UMat batchResultRoi = batchResult(roi);
            cv::UMat batchMaskRoi = batchMask(roi);

            maskedResult.copyTo(batchResultRoi, mask);
            cv::bitwise_or(batchMaskRoi, mask, batchMaskRoi);
            remapTimer.stop();
        }

        // 合併批次結果到輸出圖像
        mergeTimer.start();
        batchResult.copyTo(outputImage, batchMask);

        // 更新累積遮罩
        cv::bitwise_or(accumulatedMask, batchMask, accumulatedMask);
        mergeTimer.stop();
    }

    totalTimer.stop();
    std::cout << "總執行時間: " << totalTimer.getTimeMilli() << " ms\n"
        << "  準備三角形數據: " << prepTimer.getTimeMilli() << " ms\n"
        << "  映射坐標計算: " << mapTimer.getTimeMilli() << " ms\n"
        << "  填充三角形遮罩: " << fillTimer.getTimeMilli() << " ms\n"
        << "  重映射和掩碼時間: " << remapTimer.getTimeMilli() << " ms\n"
        << "  結果合併時間: " << mergeTimer.getTimeMilli() << " ms" << std::endl;
}
*/
/*
void applyGridDeformationToImage(const cv::UMat& inputImage, cv::UMat& outputImage, std::set<Triangle*, TriangleComparator> triangles) {
    cv::TickMeter totalTimer, fillTimer, warpTimer, copyTimer, maskTimer, mergeTimer, accumTimer;
    totalTimer.start();

    // 確保OpenCL已啟用
    cv::ocl::setUseOpenCL(true);

    // 預先分配記憶體
    inputImage.copyTo(outputImage);
    cv::UMat accumulatedMask = cv::UMat::zeros(inputImage.size(), CV_8UC1);

    // 預先過濾有效三角形並收集所有數據
    std::vector<std::tuple<std::vector<cv::Point2f>, std::vector<cv::Point2f>, std::vector<cv::Point>>> validTriangles;
    validTriangles.reserve(triangles.size());

    for (const Triangle* triangle : triangles) {
        if (!triangle->v1 || !triangle->v2 || !triangle->v3) continue;
        validTriangles.emplace_back(
            std::vector<cv::Point2f>{triangle->v1->position, triangle->v2->position, triangle->v3->position},
            std::vector<cv::Point2f>{triangle->v1->position_modified, triangle->v2->position_modified, triangle->v3->position_modified},
            std::vector<cv::Point>{
            cv::Point(static_cast<int>(triangle->v1->position_modified.x), static_cast<int>(triangle->v1->position_modified.y)),
                cv::Point(static_cast<int>(triangle->v2->position_modified.x), static_cast<int>(triangle->v2->position_modified.y)),
                cv::Point(static_cast<int>(triangle->v3->position_modified.x), static_cast<int>(triangle->v3->position_modified.y))
        }
        );
    }

    // 預先計算所有仿射矩陣
    std::vector<cv::UMat> warpMats(validTriangles.size());

#pragma omp parallel for
    for (int i = 0; i < validTriangles.size(); i++) {
        // 計算仿射矩陣 (全圖坐標系)
        cv::Mat warpMat = cv::getAffineTransform(
            std::get<0>(validTriangles[i]).data(),
            std::get<1>(validTriangles[i]).data()
        );
        warpMat.copyTo(warpMats[i]);
    }

    const int BATCH_SIZE = 100;
    cv::UMat batchMask = cv::UMat::zeros(inputImage.size(), CV_8UC1);
    cv::UMat batchResult = cv::UMat::zeros(inputImage.size(), inputImage.type());

    for (size_t i = 0; i < validTriangles.size(); i += BATCH_SIZE) {
        size_t endIdx = std::min(i + BATCH_SIZE, validTriangles.size());
        batchMask.setTo(cv::Scalar(0));
        batchResult.setTo(cv::Scalar(0));

        for (size_t j = i; j < endIdx; j++) {
            // 獲取目標三角形的邊界框作為 ROI
            const auto& dstTriangle = std::get<2>(validTriangles[j]);

            // 計算目標三角形的外接矩形（ROI）
            int minX = INT_MAX, minY = INT_MAX, maxX = 0, maxY = 0;
            for (const auto& pt : dstTriangle) {
                minX = std::min(minX, pt.x);
                minY = std::min(minY, pt.y);
                maxX = std::max(maxX, pt.x);
                maxY = std::max(maxY, pt.y);
            }

            // 確保 ROI 在圖像範圍內
            minX = std::max(0, minX);
            minY = std::max(0, minY);
            maxX = std::min(inputImage.cols - 1, maxX);
            maxY = std::min(inputImage.rows - 1, maxY);

            // 確保 ROI 有效
            if (maxX <= minX || maxY <= minY) continue;

            cv::Rect dstRoi(minX, minY, maxX - minX + 1, maxY - minY + 1);

            // 方法 1: 保持全圖變換，只在 ROI 區域填充三角形遮罩
            fillTimer.start();
            cv::UMat triangleMask = cv::UMat::zeros(inputImage.size(), CV_8UC1);
            cv::fillConvexPoly(triangleMask, dstTriangle, cv::Scalar(255), cv::LINE_8, 0);

            // 只保留 ROI 區域的遮罩
            cv::UMat triangleMaskRoi = triangleMask(dstRoi);
            fillTimer.stop();

            // 使用全圖的仿射變換
            warpTimer.start();
            cv::UMat warpedImage = cv::UMat(inputImage.size(), inputImage.type());
            cv::warpAffine(inputImage, warpedImage, warpMats[j], inputImage.size(),
                cv::INTER_CUBIC, cv::BORDER_TRANSPARENT);

            // 提取 ROI 區域的變換結果
            cv::UMat warpedRoi = warpedImage(dstRoi);
            warpTimer.stop();

            // 在 ROI 區域應用遮罩
            copyTimer.start();
            cv::UMat maskedResult;
            cv::bitwise_and(warpedRoi, warpedRoi, maskedResult, triangleMaskRoi);

            // 更新批次結果
            cv::UMat batchResultRoi = batchResult(dstRoi);
            maskedResult.copyTo(batchResultRoi, triangleMaskRoi);
            copyTimer.stop();

            // 更新批次遮罩
            maskTimer.start();
            cv::UMat batchMaskRoi = batchMask(dstRoi);
            cv::bitwise_or(batchMaskRoi, triangleMaskRoi, batchMaskRoi);
            maskTimer.stop();
        }

        // 合併批次結果到輸出圖像
        mergeTimer.start();
        batchResult.copyTo(outputImage, batchMask);
        mergeTimer.stop();

        // 更新累積遮罩
        accumTimer.start();
        cv::bitwise_or(accumulatedMask, batchMask, accumulatedMask);
        accumTimer.stop();
    }

    totalTimer.stop();
    std::cout << "總執行時間: " << totalTimer.getTimeMilli() << " ms\n"
        << "  填充遮罩時間: " << fillTimer.getTimeMilli() << " ms\n"
        << "  仿射變換時間: " << warpTimer.getTimeMilli() << " ms\n"
        << "  複製結果時間: " << copyTimer.getTimeMilli() << " ms\n"
        << "  批次遮罩時間: " << maskTimer.getTimeMilli() << " ms\n"
        << "  結果合併時間: " << mergeTimer.getTimeMilli() << " ms\n"
        << "  累積遮罩時間: " << accumTimer.getTimeMilli() << " ms" << std::endl;
}
*/



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
    return angle * 180.0f / 3.1415f;
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
            std::vector<GridNode*> triVertices = { tri->v1, tri->v2, tri->v3 };
            std::vector<GridNode*> tempVertices = { tempTriangle.v1, tempTriangle.v2, tempTriangle.v3 };

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
std::vector<GridNode> generateTriangleGrid(const cv::UMat& image, const cv::UMat& centralMask,
                                           cv::Rect region, int gridSize) {
    std::vector<GridNode> gridNodes;
    int dx = gridSize;
    int dy = gridSize * sqrt(3) / 2;  // 正三角形高度

    int rows = region.height / dy;
    int cols = region.width / dx;

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

    // 3. **篩選有效節點**
    std::vector<GridNode> validNodes;

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
std::vector<GridNode> extractGridPoints(UMat& image, int gridSize) {
    // Check if OpenCL is available and enable it


    std::vector<GridNode> gridNodes;

    // Convert regular Mat to UMat for OpenCL processing
    cv::UMat uImage = image.clone();

    // 讀取 Alpha 通道
    cv::UMat alpha;
    std::vector<cv::UMat> channels;
    cv::split(uImage, channels);
    alpha = channels[3];

    // 建立二值圖
    cv::UMat binary;
    cv::threshold(alpha, binary, 1, 255, cv::THRESH_BINARY);

    // 將 UMat 轉回 Mat 用於輪廓檢測 (findContours 不完全支援 UMat)
    cv::Mat binaryMat = binary.getMat(cv::ACCESS_READ);

    // 找出輪廓
    std::vector<std::vector<cv::Point>> contours;
    cv::findContours(binaryMat, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
    if (contours.empty()) {
        std::cout << "No objects detected!" << std::endl;
        return gridNodes;
    }

    // 找到最接近中心的色塊
    cv::Point imgCenter(image.cols / 2, image.rows / 2);
    double minDist = DBL_MAX;
    std::vector<cv::Point> bestContour;
    for (const auto& contour : contours) {
        cv::Rect bbox = cv::boundingRect(contour);
        cv::Point bboxCenter(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
        double dist = cv::norm(bboxCenter - imgCenter);
        if (dist < minDist) {
            minDist = dist;
            bestContour = contour;
        }
    }

    // 創建一個只包含中央色塊的遮罩
    cv::UMat centralMask = cv::UMat::zeros(image.size(), CV_8UC1);

    // 將 bestContour 轉換為適合 fillPoly 的格式
    std::vector<cv::Point> bestContourPoints(bestContour.begin(), bestContour.end());
    std::vector<std::vector<cv::Point>> bestContours = { bestContourPoints };

    // 使用 OpenCL 加速的 fillPoly
    cv::Mat centralMaskMat = centralMask.getMat(cv::ACCESS_WRITE);
    cv::fillPoly(centralMaskMat, bestContours, cv::Scalar(255));
    centralMask = centralMaskMat.getUMat(cv::ACCESS_READ);

    debugMask = centralMask.clone();

    // 取得最佳色塊邊界
    cv::Rect bestBox = cv::boundingRect(bestContour);

    // 稍微擴大框
    bestBox = cv::Rect(bestBox.x - bestBox.width / 8, bestBox.y - bestBox.height / 8,
                       bestBox.width + bestBox.width / 4, bestBox.height + bestBox.height / 4);

    cv::Mat debugMaskMat = debugMask.getMat(cv::ACCESS_READ);
    cv::rectangle(debugMaskMat, bestBox, cv::Scalar(125, 125, 125), 4);
    //debugMask = debugMaskMat;

    debugBox = bestBox;

    return generateTriangleGrid(image, centralMask, bestBox, gridSize);
}


void drawGrid(cv::UMat& image, const std::set<Triangle*, TriangleComparator>& triangle_set) {
    if (triangle_set.empty()) return;

    // 預先分配足夠的記憶體
    std::vector<std::vector<cv::Point>> allContours;
    allContours.reserve(triangle_set.size());

    // 批量收集所有三角形
    for (const auto& triangle : triangle_set) {
        if (!triangle->v1 || !triangle->v2 || !triangle->v3) continue;

        allContours.push_back({
                                  cv::Point(static_cast<int>(triangle->v1->position_modified.x), static_cast<int>(triangle->v1->position_modified.y)),
                                  cv::Point(static_cast<int>(triangle->v2->position_modified.x), static_cast<int>(triangle->v2->position_modified.y)),
                                  cv::Point(static_cast<int>(triangle->v3->position_modified.x), static_cast<int>(triangle->v3->position_modified.y))
                              });
    }

    // 一次性繪製所有三角形線條
    const cv::Scalar border_color(255, 0, 0, 255);
    cv::polylines(image, allContours, true, border_color, 2, cv::LINE_AA);
}



void updateImagePost(bool cloneOriginImage = true) {
    cv::TickMeter tm;
    tm.start();

    if (cloneOriginImage) {
        // 避免不必要的記憶體拷貝
        image_post.copyTo(image_show);
    }

    drawGrid(image_show, g_triangle_set);

    tm.stop();
   // std::cout << "UpdateImagePost time: " << tm.getTimeMilli() << " ms" << std::endl;

    for (const auto& bone : state.bones) {
        line(image_show, bone.head, bone.tail, Scalar(255,255,0,255), 2);
        circle(image_show, bone.head, 5, Scalar(255,255,255,255), -1);  // 绘制端点
        circle(image_show, bone.tail, 5, Scalar(255,255,255,255), -1);
    }
}


Point srcImagePosition(double x, double y, double w, double h)
{
    double x2 = x * (double)image.cols / w;
    double y2 = y * (double)image.rows / h;
    return Point(x2, y2);
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
        }else if (mg_match(hm->uri, mg_str("/imageShowDebug"), NULL)) {
            // 配置圖片路徑，這裡假設圖片名為 "image.jpg" 並位於當前目錄

            std::vector<uchar> buffer;
            if (!imencode(".png", image_show, buffer)) {
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
        else if (mg_match(hm->uri, mg_str("/maskDebug"), NULL)) {
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


            /*
            std::vector<uchar> buffer;
            if (!imencode(".png", image_show, buffer)) {
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
            */
            mg_http_reply(conn, 200, "Content-Type: application/json\r\n",
                "{\"status\": \"ok\"}");
            return;
        }
        else if (mg_match(hm->uri, mg_str("/api/points"), NULL)) // one click ( mouse down then up )
        {
            std::cout << " control mode : " << controlMode << std::endl;
            json result;
            result["success"] = true;
            result["message"] = "good";
            std::cout << " hello ~" << std::endl;
            std::string input(hm->body.buf);
            json data = json::parse(input);

            std::cout << " hi input :" << input << endl;


            double x = data["x"];
            double y = data["y"];
            double w = data["scw"];
            double h = data["sch"];
            if (controlMode == 0)
            {


                std::cout << " what's my size: " << image.rows << " , " << image.cols << std::endl;
                Point srcPoint = srcImagePosition(x, y, w, h);
                //circle(image_post, srcPoint, 10, Scalar(255, 255, 0, 255), FILLED);
                auto nearPoint = findNearestGridNodeOptimized(gridNodes, { srcPoint.x,srcPoint.y });

                if (nearPoint == nullptr)
                {
                    std::cout << " not find gridPoint ... " << std::endl;
                    mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());
                    return;
                }
                Point nearPointCv(nearPoint->position_modified.x, nearPoint->position_modified.y);

                double distance = cv::norm(nearPointCv - srcPoint);

                if (distance < 20)
                {
                    selectNode = nearPoint;
                    std::cout << " I would draw a near point at : " << nearPoint->position.x << " , " << nearPoint->position.y << std::endl;
                    //circle(image_post, Point(nearPoint->position.x, nearPoint->position.y), 10, Scalar(0, 255, 255, 255), FILLED);


                    std::cout << " select node : " << selectNode->position.x << " , " << selectNode->position.y << std::endl;

                    std::cout << " select node neighbor : " << selectNode->neighbors.size() << " , triangle : " << selectNode->triangles.size() << std::endl;
                    for (auto& tri : selectNode->triangles)
                    {
                        std::cout << " tri points : " << tri->v1->position << " , " << tri->v2->position << " , " << tri->v3->position << std::endl;


                    }
                    std::cout << "total triangle set : " << g_triangle_set.size() << std::endl;

                }
            }
            else if (controlMode == 1)
            {
                double x = data["x"];
                double y = data["y"];
                double w = data["scw"];
                double h = data["sch"];


                std::cout << " doing bone function ... " << std::endl;
            }
            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());

        }
        else if (mg_match(hm->uri, mg_str("/api/clickStart"), NULL)) // on mouse press
        {

            json result;
            result["success"] = true;
            result["message"] = "good";
            std::cout << " hi drag done ... " << std::endl;
            std::string input(hm->body.buf);
            json data = json::parse(input);
            double x = data["x"];
            double y = data["y"];
            double w = data["scw"];
            double h = data["sch"];

            Point mousePos = srcImagePosition(x, y, w, h);
            if (controlMode == 0)
            {
                std::cout<<" click start point mode ! "<<mousePos<<std::endl;
            }
            else if (controlMode == 1)
            {
                firstClick = mousePos;

                std::cout<<" click start bone mode !  "<<mousePos<<" data: "<<data<<std::endl;

                double minDist = INFINITY;
                for (auto& bone : state.bones) {
                    double dist = distancePointToLine(mousePos, bone.head, bone.tail);
                    if (dist < bone.thickness && dist < minDist) {
                        minDist = dist;
                        state.selectedBone = &bone;
                    }
                }

                if (state.selectedBone) {
                    state.dragStart = mousePos;
                    state.originalHead = state.selectedBone->head;
                    state.originalTail = state.selectedBone->tail;

                    // 检测是否靠近端点
                    double toHead = norm(mousePos - state.selectedBone->head);
                    double toTail = norm(mousePos - state.selectedBone->tail);
                    double threshold = 10.0;

                    if (toHead < threshold) {
                        state.mode = AppState::DRAG_HEAD;
                    } else if (toTail < threshold) {
                        state.mode = AppState::DRAG_TAIL;
                    }
                    else if (data["ctrlKey"]==true) {  // 按住Ctrl旋转
                        std::cout << " rotate? " << endl;
                               state.mode = AppState::ROTATE;
                               Point mid = (state.originalHead + state.originalTail) * 0.5;
                               state.rotateCenter = mid;
                               Point vecInit = state.dragStart - mid;
                               state.initialAngle = atan2(vecInit.y, vecInit.x);
                           }
                    else {
                        state.mode = AppState::TRANSLATE;
                    }
                }
            }
            std::cout<<" bone count : "<<state.bones.size()<<std::endl;
            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());

        }

        else if (mg_match(hm->uri, mg_str("/api/drag"), NULL))  // on mouse move ( when click first )
        {


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
            Point mousePos = srcImagePosition(x, y, w, h);
            if (controlMode == 0)
            {
                if (selectNode)
                {

                    selectNode->position_modified.x = mousePos.x;
                    selectNode->position_modified.y = mousePos.y;
                    //   circle(image_post, Point(selectNode->position_modified.x, selectNode->position_modified.y), 10, Scalar(0,255, 255, 255), FILLED);

                    // std::cout<<" let's doing deform ... "<<std::endl;

                    ///applyGridDeformationToImage(image,image_post);
                    //updateImagePost(false);
                    // cv::Mat deformed = deformImageWithGrid(gridNodes, image,image.rows, image.cols);
                    
                      
                        //select_triangle_set.clear();

                        for (auto& tri : selectNode->triangles)
                        {
                            select_triangle_set.insert(tri);
                        }
                        applyGridDeformationToImage(image, image_post, select_triangle_set);
                        //std::cout << "deform done ... " << std::endl;
                        updateImagePost(true);
                        // cv::Mat deformed = deformImageWithGrid(gridNodes, image,image.rows, image.cols);

                       // std::cout << "redraw done " << std::endl;
                        static KDTree kdTree;
                        kdTree.modifyNode(selectNode, selectNode->position_modified);
                      
                        updateImagePost(true);
                    // std::cout<<"deform done ... "<<std::endl;
                }
            }
            else if(controlMode==1)
            {
                Point delta = mousePos - state.dragStart;

                switch (state.mode) {
                case AppState::DRAG_HEAD:
                    state.selectedBone->head = state.originalHead + delta;
                    break;

                case AppState::DRAG_TAIL:
                    state.selectedBone->tail = state.originalTail + delta;
                    break;

                case AppState::TRANSLATE:
                    state.selectedBone->head = state.originalHead + delta;
                    state.selectedBone->tail = state.originalTail + delta;
                    break;

                case AppState::ROTATE: {
                    Point vecCurrent = mousePos - state.rotateCenter;
                    double currentAngle = atan2(vecCurrent.y, vecCurrent.x);
                    double deltaAngle = currentAngle - state.initialAngle;

                    state.selectedBone->head = rotatePoint(state.originalHead, state.rotateCenter, deltaAngle);
                    state.selectedBone->tail = rotatePoint(state.originalTail, state.rotateCenter, deltaAngle);
                    break;
                }
                }
                updateImagePost(true);
            }

            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());

        }
        else if (mg_match(hm->uri, mg_str("/api/dragDone"), NULL))  // on mouse up
        {

            json result;
            result["success"] = true;
            result["message"] = "good";
            std::cout << " hi drag done ... " << std::endl;
            std::string input(hm->body.buf);
            json data = json::parse(input);
            double x = data["x"];
            double y = data["y"];
            double w = data["scw"];
            double h = data["sch"];

            Point mousePos = srcImagePosition(x, y, w, h);


            if (controlMode == 0)
            {

                // std::cout << " dragging ~" <<data<< std::endl;

                if (selectNode)
                {
                    std::cout << " let's doing deform ... " << std::endl;
                    //select_triangle_set.clear();

                    for (auto& tri : selectNode->triangles)
                    {
                        select_triangle_set.insert(tri);
                    }
                    applyGridDeformationToImage(image, image_post, select_triangle_set);
                    std::cout << "deform done ... " << std::endl;
                    updateImagePost(true);
                    // cv::Mat deformed = deformImageWithGrid(gridNodes, image,image.rows, image.cols);

                    std::cout << "redraw done " << std::endl;
                    static KDTree kdTree;
                    kdTree.modifyNode(selectNode, selectNode->position_modified);
                    selectNode = nullptr;
                }
            }
            else if (controlMode == 1)
            {
                secondClick = mousePos;
                if (!state.selectedBone)
                {                 // 添加新骨架（示例：固定长度）
                    std::cout<<" somehow add bone ... "<<std::endl;
                    state.bones.emplace_back(firstClick, secondClick,10.0, Scalar(255,0,0));
                }

                updateImagePost(true);
                state.selectedBone = nullptr;
                state.mode = AppState::NONE;
                /*
                auto newBone = Bone::Create("newChild");
                std::cout<<" creat bone : "<<newBone<<" from : "<<firstClick<<" to "<<secondClick<<std::endl;
                newBone->setPoint(firstClick, secondClick);
                std::cout<<" draw UMAT line! "<<std::endl;
                line(image_show, firstClick, secondClick, Scalar(0, 0, 255,255), 10);

                */
            }
            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", result.dump().c_str());

        }
        else if (mg_match(hm->uri, mg_str("/api/layer/save"), NULL)) {

            std::cout << " hi someong call me ... " << std::endl;

            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", "{\"success\":true,\"message\":\"專案儲存成功\"}");

        }
        else if (mg_match(hm->uri, mg_str("/api/tool1"), NULL)) {

            std::string input(hm->body.buf);
            json data = json::parse(input);

            cout << " hi choose tool : " << data << endl;
            if (mg_strcmp(hm->method, mg_str("POST")) != 0) {
                mg_http_reply(conn, 405, "Content-Type: application/json\r\n", "{\"success\":false,\"message\":\"方法不允許，需要 POST 請求\"}");
                return;
            }
            if (data["tool"] == "bone-create")
            {
                controlMode = 1;
            }
            else if (data["tool"] == "grab-point")
            {
                controlMode = 0;
            }

            std::cout << " hi someong call me  "<< data["tool"]<<" now my control mode = "<<controlMode << std::endl;

            mg_http_reply(conn, 200, "Content-Type: application/json\r\n", "{\"success\":true,\"message\":\"nice\"}");

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

    std::cout << " try read ... " << std::endl;
    Mat testRead = imread("png3.png");
    cout << " test size : " << testRead.size() << std::endl;
    /*
    std::cout << "OpenCL enabled: " << cv::ocl::useOpenCL() << std::endl;
    // grayscaleWithOpenCL("test.jpg");
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

   
   

    image = imread("png3.png", IMREAD_UNCHANGED).getUMat(cv::ACCESS_READ);
    image_post = image.clone();
    gridNodes = extractGridPoints(image, 40);
    updateImagePost();

    std::cout << " init grid point! " << std::endl;
    findNearestGridNodeOptimized(gridNodes, { 0,0 });
    // 設置HTTP服務器監聽地址和端口
     */
    struct mg_mgr mgr;
    mg_mgr_init(&mgr);
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
