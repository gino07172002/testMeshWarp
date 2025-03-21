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
