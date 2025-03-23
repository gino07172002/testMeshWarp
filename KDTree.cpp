#include "KDTree.h"

void Triangle::removeFromGridNodes() {
    if (v1) {
        auto it = std::find(v1->triangles.begin(), v1->triangles.end(), this);
        if (it != v1->triangles.end()) {
            v1->triangles.erase(it);
        }
    }
    if (v2) {
        auto it = std::find(v2->triangles.begin(), v2->triangles.end(), this);
        if (it != v2->triangles.end()) {
            v2->triangles.erase(it);
        }
    }
    if (v3) {
        auto it = std::find(v3->triangles.begin(), v3->triangles.end(), this);
        if (it != v3->triangles.end()) {
            v3->triangles.erase(it);
        }
    }
}

std::vector<cv::Point2f> Triangle::getOriginalPoints() {
    return { v1->position, v2->position, v3->position };
}

// 取得變形後的三角形頂點
std::vector<cv::Point2f> Triangle::getModifiedPoints() {
    return { v1->position_modified, v2->position_modified, v3->position_modified };
}
