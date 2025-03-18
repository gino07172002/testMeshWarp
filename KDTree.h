#pragma once
#include <iostream>
#include <opencv2/opencv.hpp>

using namespace std;
using namespace cv;
struct myPoint {
    float x, y;
};

struct GridNode {
    myPoint position;
    std::vector<GridNode*> neighbors;
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

