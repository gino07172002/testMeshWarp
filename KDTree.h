#pragma once
#include <iostream>
#include <opencv2/opencv.hpp>

using namespace std;
using namespace cv;
struct myPoint {
    float x, y;
};

struct GridNode; // 前向宣告

struct Triangle {
    GridNode* v1;  // 三角形頂點 1
    GridNode* v2;  // 三角形頂點 2
    GridNode* v3;  // 三角形頂點 3

    // 默認構造函數
    Triangle() : v1(nullptr), v2(nullptr), v3(nullptr) {}

    // 構造函數
    Triangle(GridNode* node1, GridNode* node2, GridNode* node3) : v1(node1), v2(node2), v3(node3) {}

    // 新增方法：從所有相關的GridNode中移除這個Triangle
    void removeFromGridNodes();
};
// 2D 三角形結構
struct GridNode {
    cv::Point2f position;            // 原始位置
    cv::Point2f position_modified;   // 變形後位置
    std::vector<GridNode*> neighbors; // 鄰居節點
    std::vector<Triangle*> triangles; // 所屬的三角形

    // 構造函數
    GridNode(const cv::Point2f& pos) : position(pos), position_modified(pos) {}

    GridNode()=default;
    // 計算當前節點的形變
    void applyDeformation() {
        // 實現形變邏輯
    }
};
struct TriangleComparator {
    bool operator()(const Triangle* lhs, const Triangle* rhs) const {
        // 獲取排序後的頂點指針以便比較
        std::vector<GridNode*> lv = {lhs->v1, lhs->v2, lhs->v3};
        std::vector<GridNode*> rv = {rhs->v1, rhs->v2, rhs->v3};

        // 排序指針，使得相同的三角形具有相同的頂點順序
        std::sort(lv.begin(), lv.end());
        std::sort(rv.begin(), rv.end());

        // 比較排序後的頂點
        return std::tie(lv[0], lv[1], lv[2]) < std::tie(rv[0], rv[1], rv[2]);
    }
};


struct GridNodeComparator {
    bool operator()(const GridNode* lhs, const GridNode* rhs) const {
        return std::tie(lhs->position.x, lhs->position.y) < std::tie(rhs->position.x, rhs->position.y);
    }
};
class Grid {
public:
   std::vector<GridNode*> nodes;  // 所有GridNode的列表
   std::set<Triangle*, TriangleComparator> triangles;;  // 所有Triangle的列表

   void addTriangle(GridNode* v1, GridNode* v2, GridNode* v3) {
       Triangle* newTriangle = new Triangle(v1, v2, v3);
       auto result = triangles.insert(newTriangle);
       if (result.second) {
           if (v1) v1->triangles.push_back(newTriangle);
           if (v2) v2->triangles.push_back(newTriangle);
           if (v3) v3->triangles.push_back(newTriangle);
       } else {
           delete newTriangle;
       }
   }
    // 方法：刪除一個Triangle
   void deleteTriangle(Triangle* tri) {
       if (tri) {
           tri->removeFromGridNodes();
           triangles.erase(tri);
           delete tri;
       }
   }

    // 方法：刪除一個GridNode
   void deleteGridNode(GridNode* node) {
       if (node) {
           for (auto tri : node->triangles) {
               deleteTriangle(tri);
           }
           for (auto neighbor : node->neighbors) {
               if (neighbor) {
                   auto it = std::find(neighbor->neighbors.begin(), neighbor->neighbors.end(), node);
                   if (it != neighbor->neighbors.end()) {
                       neighbor->neighbors.erase(it);
                   }
               }
           }
           auto it = std::find(nodes.begin(), nodes.end(), node);
           if (it != nodes.end()) {
               nodes.erase(it);
           }
           delete node;
       }
   }

    // 方法：清理不在任何Triangle中的GridNode
    void cleanupOrphanedNodes() {
        std::vector<GridNode*> toDelete;
        for (auto node : nodes) {
            if (node->triangles.empty()) {
                toDelete.push_back(node);
            }
        }
        for (auto node : toDelete) {
            deleteGridNode(node);
        }
    }

    ~Grid() {
        for (auto tri : triangles) {
            delete tri;
        }
        for (auto node : nodes) {
            delete node;
        }
    }
};



class KDTree {
private:
    struct KDNode {
        GridNode* data;
        KDNode* left;
        KDNode* right;
        int splitDim;

        KDNode(GridNode* node) : data(node), left(nullptr), right(nullptr), splitDim(0) {}
    };

    KDNode* root;

    // 递归构建 KD 树
    KDNode* buildKDTree(std::vector<GridNode*>& points, int start, int end, int depth) {
        if (start > end) return nullptr;

        int dim = depth % 2;  // 0 代表 x 维度，1 代表 y 维度

        // 根据当前维度排序
        int mid = (start + end) / 2;
        std::nth_element(points.begin() + start, points.begin() + mid, points.begin() + end + 1,
            [dim](GridNode* a, GridNode* b) {
                return dim == 0 ? a->position.x < b->position.x : a->position.y < b->position.y;
            });

        // 创建节点
        KDNode* node = new KDNode(points[mid]);
        node->splitDim = dim;

        // 递归构建左右子树
        node->left = buildKDTree(points, start, mid - 1, depth + 1);
        node->right = buildKDTree(points, mid + 1, end, depth + 1);

        return node;
    }

    // 递归查找最近点
    void findNearest(KDNode* node, const myPoint& target, GridNode*& bestNode, float& bestDist, int depth) {
        if (!node) return;

        int dim = depth % 2;  // 当前分割维度

        // 计算当前节点与目标点的距离
        float dx = node->data->position.x - target.x;
        float dy = node->data->position.y - target.y;
        float dist = dx * dx + dy * dy;

        // 更新最近点
        if (dist < bestDist) {
            bestDist = dist;
            bestNode = node->data;
        }

        // 决定先搜索哪个子树
        float splitValue = (dim == 0) ? node->data->position.x : node->data->position.y;
        float targetValue = (dim == 0) ? target.x : target.y;

        KDNode* nearerNode = (targetValue < splitValue) ? node->left : node->right;
        KDNode* furtherNode = (targetValue < splitValue) ? node->right : node->left;

        // 先搜索更可能包含最近点的子树
        findNearest(nearerNode, target, bestNode, bestDist, depth + 1);

        // 检查是否需要搜索另一个子树
        float splitDist = targetValue - splitValue;
        splitDist *= splitDist;

        if (splitDist < bestDist) {
            findNearest(furtherNode, target, bestNode, bestDist, depth + 1);
        }
    }

public:
    KDTree() : root(nullptr) {}

    ~KDTree() {
        // 释放内存的代码（略）
    }

    // 从 GridNode 集合构建 KD 树
    void build(std::vector<GridNode>& gridNodes) {
        std::vector<GridNode*> points;
        for (auto& node : gridNodes) {
            points.push_back(&node);
        }

        root = buildKDTree(points, 0, points.size() - 1, 0);
    }

    // 查找最近点
    GridNode* findNearest(const myPoint& target) {
        if (!root) return nullptr;

        GridNode* bestNode = nullptr;
        float bestDist = std::numeric_limits<float>::max();

        findNearest(root, target, bestNode, bestDist, 0);
        return bestNode;
    }
};

