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

    std::vector<cv::Point2f> getOriginalPoints();

    // 取得變形後的三角形頂點
    std::vector<cv::Point2f> getModifiedPoints();
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
                return dim == 0 ? a->position_modified.x < b->position_modified.x : a->position_modified.y < b->position_modified.y;
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
    void findNearest(KDNode* node, const cv::Point2f& target, GridNode*& bestNode, float& bestDist, int depth) {
        if (!node) return;
        int dim = depth % 2;  // 当前分割维度
        // 计算当前节点与目标点的距离
        float dx = node->data->position_modified.x - target.x;
        float dy = node->data->position_modified.y - target.y;
        float dist = dx * dx + dy * dy;
        // 更新最近点
        if (dist < bestDist) {
            bestDist = dist;
            bestNode = node->data;
        }
        // 决定先搜索哪个子树
        float splitValue = (dim == 0) ? node->data->position_modified.x : node->data->position_modified.y;
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

    // 递归插入节点
    KDNode* insertRecursive(KDNode* node, GridNode* point, int depth) {
        if (node == nullptr) {
            KDNode* newNode = new KDNode(point);
            newNode->splitDim = depth % 2;
            return newNode;
        }

        int dim = depth % 2;
        float nodeValue = (dim == 0) ? node->data->position_modified.x : node->data->position_modified.y;
        float pointValue = (dim == 0) ? point->position_modified.x : point->position_modified.y;

        if (pointValue < nodeValue) {
            node->left = insertRecursive(node->left, point, depth + 1);
        }
        else {
            node->right = insertRecursive(node->right, point, depth + 1);
        }

        return node;
    }

    // 查找子树中的最小值节点
    KDNode* findMin(KDNode* node, int dim, int depth) {
        if (node == nullptr) return nullptr;

        int curDim = depth % 2;

        if (curDim == dim) {
            if (node->left == nullptr) return node;
            return findMin(node->left, dim, depth + 1);
        }
        else {
            KDNode* leftMin = findMin(node->left, dim, depth + 1);
            KDNode* rightMin = findMin(node->right, dim, depth + 1);

            KDNode* minNode = node;

            if (leftMin != nullptr) {
                float nodeValue = (dim == 0) ? minNode->data->position_modified.x : minNode->data->position_modified.y;
                float leftValue = (dim == 0) ? leftMin->data->position_modified.x : leftMin->data->position_modified.y;
                if (leftValue < nodeValue) minNode = leftMin;
            }

            if (rightMin != nullptr) {
                float minValue = (dim == 0) ? minNode->data->position_modified.x : minNode->data->position_modified.y;
                float rightValue = (dim == 0) ? rightMin->data->position_modified.x : rightMin->data->position_modified.y;
                if (rightValue < minValue) minNode = rightMin;
            }

            return minNode;
        }
    }

    // 递归删除节点
    KDNode* deleteRecursive(KDNode* node, const cv::Point2f& point, int depth) {
        if (node == nullptr) return nullptr;

        int dim = depth % 2;

        // 判断是否为目标节点
        if (node->data->position_modified.x == point.x && node->data->position_modified.y == point.y) {
            // 情况1: 叶子节点，直接删除
            if (node->right == nullptr && node->left == nullptr) {
                delete node;
                return nullptr;
            }
            // 情况2: 有右子树，找右子树中当前维度的最小值
            else if (node->right != nullptr) {
                KDNode* minNode = findMin(node->right, dim, depth + 1);
                // 复制数据
                node->data = minNode->data;
                // 递归删除找到的最小值节点
                node->right = deleteRecursive(node->right, minNode->data->position_modified, depth + 1);
            }
            // 情况3: 无右子树但有左子树，找左子树中当前维度的最小值
            else {
                KDNode* minNode = findMin(node->left, dim, depth + 1);
                // 复制数据
                node->data = minNode->data;
                // 将左子树变为右子树，并递归删除找到的最小值节点
                node->right = node->left;
                node->left = nullptr;
                node->right = deleteRecursive(node->right, minNode->data->position_modified, depth + 1);
            }
        }
        else {
            // 递归搜索正确的子树
            float nodeValue = (dim == 0) ? node->data->position_modified.x : node->data->position_modified.y;
            float pointValue = (dim == 0) ? point.x : point.y;

            if (pointValue < nodeValue) {
                node->left = deleteRecursive(node->left, point, depth + 1);
            }
            else {
                node->right = deleteRecursive(node->right, point, depth + 1);
            }
        }

        return node;
    }

    // 递归删除节点
    KDNode* deleteRecursive(KDNode* node, GridNode* gridNode, int depth) {
        if (node == nullptr) return nullptr;

        int dim = depth % 2;

        // 判断是否为目标节点 (通过内存地址比较或位置比较)
        bool isSameNode = (node->data == gridNode ||
            (node->data->position.x == gridNode->position.x &&
                node->data->position.y == gridNode->position.y));

        if (isSameNode) {
            // 情况1: 叶子节点，直接删除
            if (node->right == nullptr && node->left == nullptr) {
                delete node;
                return nullptr;
            }
            // 情况2: 有右子树，找右子树中当前维度的最小值
            else if (node->right != nullptr) {
                KDNode* minNode = findMin(node->right, dim, depth + 1);
                // 复制数据
                node->data = minNode->data;
                // 递归删除找到的最小值节点
                node->right = deleteRecursive(node->right, minNode->data, depth + 1);
            }
            // 情况3: 无右子树但有左子树，找左子树中当前维度的最小值
            else {
                KDNode* minNode = findMin(node->left, dim, depth + 1);
                // 复制数据
                node->data = minNode->data;
                // 将左子树变为右子树，并递归删除找到的最小值节点
                node->right = node->left;
                node->left = nullptr;
                node->right = deleteRecursive(node->right, minNode->data, depth + 1);
            }
        }
        else {
            // 递归搜索正确的子树
            float nodeValue = (dim == 0) ? node->data->position.x : node->data->position.y;
            float pointValue = (dim == 0) ? gridNode->position.x : gridNode->position.y;

            if (pointValue < nodeValue) {
                node->left = deleteRecursive(node->left, gridNode, depth + 1);
            }
            else {
                node->right = deleteRecursive(node->right, gridNode, depth + 1);
            }
        }

        return node;
    }

    // 递归释放内存
    void deleteTree(KDNode* node) {
        if (node == nullptr) return;
        deleteTree(node->left);
        deleteTree(node->right);
        delete node;
    }

    // 查找精确匹配的节点
    KDNode* findExact(KDNode* node, const cv::Point2f& target, int depth) {
        if (node == nullptr) return nullptr;

        // 检查当前节点是否为目标
        if (node->data->position_modified.x == target.x && node->data->position_modified.y == target.y) {
            return node;
        }

        int dim = depth % 2;
        float nodeValue = (dim == 0) ? node->data->position.x : node->data->position.y;
        float targetValue = (dim == 0) ? target.x : target.y;

        // 递归搜索子树
        if (targetValue < nodeValue) {
            return findExact(node->left, target, depth + 1);
        }
        else {
            return findExact(node->right, target, depth + 1);
        }
    }

    KDNode* findExact(KDNode* node, GridNode* gridNode, int depth) {
        if (node == nullptr) return nullptr;

        // 检查当前节点是否为目标 (通过内存地址或位置比较)
        if (node->data == gridNode ||
            (node->data->position.x == gridNode->position.x &&
                node->data->position.y == gridNode->position.y)) {
            return node;
        }

        int dim = depth % 2;
        float nodeValue = (dim == 0) ? node->data->position.x : node->data->position.y;
        float targetValue = (dim == 0) ? gridNode->position.x : gridNode->position.y;

        // 递归搜索子树
        if (targetValue < nodeValue) {
            return findExact(node->left, gridNode, depth + 1);
        }
        else {
            return findExact(node->right, gridNode, depth + 1);
        }
    }

public:
    KDTree() : root(nullptr) {}

    ~KDTree() {
        deleteTree(root);
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
    GridNode* findNearest(const cv::Point2f& target) {
        if (!root) return nullptr;
        GridNode* bestNode = nullptr;
        float bestDist = std::numeric_limits<float>::max();
        findNearest(root, target, bestNode, bestDist, 0);
        return bestNode;
    }

    // 新增: 插入节点 (使用GridNode*参数)
    void insert(GridNode* gridNode) {
        if (!gridNode) return;
        root = insertRecursive(root, gridNode, 0);
    }

    // 新增: 删除节点 (使用GridNode*参数)
    bool remove(GridNode* gridNode) {
        if (!gridNode) return false;

        KDNode* node = findExact(root, gridNode, 0);
        if (node == nullptr) return false; // 节点不存在

        root = deleteRecursive(root, gridNode, 0);
        return true;
    }

    // 新增: 修改节点 (使用GridNode*参数)
    bool modifyNode(GridNode* gridNode, const cv::Point2f& newPosition) {
        if (!gridNode) return false;

        // 先找到节点
        KDNode* node = findExact(root, gridNode, 0);
        if (node == nullptr) return false; // 节点不存在

        // 方法1: 删除再插入 (适用于树结构需要保持平衡的情况)
        if (remove(gridNode)) {
            // 更新位置
            gridNode->position = newPosition;
            gridNode->position_modified = newPosition; // 也更新修改后的位置
            // 重新插入
            insert(gridNode);
            return true;
        }

        // 如果删除失败
        return false;
    }

    // 新增: 直接更新节点位置 (不重构树，适用于小幅度移动)
    bool updateNodePosition(GridNode* gridNode, const cv::Point2f& newPosition) {
        if (!gridNode) return false;

        std::cout << " update select gridNode ..." << std::endl;
        KDNode* node = findExact(root, gridNode, 0);
        if (node == nullptr) return false; // 节点不存在

        // 直接更新位置 (注意: 这可能会破坏KD树的属性, 仅适用于临时修改)
    //    gridNode->position = newPosition;
        gridNode->position_modified = newPosition;
        return true;
    }
};

