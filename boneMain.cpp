#include <opencv2/opencv.hpp>
#include <vector>
#include <cmath>

using namespace cv;
using namespace std;

struct Bone {
    Point head;
    Point tail;
    float thickness;  // 可点击区域的半径
    Scalar color;
    
    Bone(Point h, Point t, float th, Scalar c) : head(h), tail(t), thickness(th), color(c) {}
};

// 计算点P到线段AB的最短距离
double distancePointToLine(const Point& P, const Point& A, const Point& B) {
    Point AB = B - A;
    Point AP = P - A;
    
    double abLengthSq = AB.x*AB.x + AB.y*AB.y;
    if (abLengthSq == 0) return norm(AP);  // A和B重合
    
    double t = (AP.x*AB.x + AP.y*AB.y) / abLengthSq;
    t = max(0.0, min(1.0, t));
    
    Point projection = A + t * AB;
    return norm(P - projection);
}

// 旋转点P绕中心点C旋转angle弧度
Point rotatePoint(const Point& P, const Point& C, double angle) {
    Point translated = P - C;
    double cosA = cos(angle);
    double sinA = sin(angle);
    return Point(
        round(translated.x*cosA - translated.y*sinA + C.x),
        round(translated.x*sinA + translated.y*cosA + C.y)
    );
}

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

void onMouse(int event, int x, int y, int flags, void* userdata) {
    AppState* state = (AppState*)userdata;
    Point mousePos(x, y);

    // 鼠标按下：检测点击
    if (event == EVENT_LBUTTONDOWN) {
        // 寻找最近的可点击骨架
        double minDist = INFINITY;
        for (auto& bone : state->bones) {
            double dist = distancePointToLine(mousePos, bone.head, bone.tail);
            if (dist < bone.thickness && dist < minDist) {
                minDist = dist;
                state->selectedBone = &bone;
            }
        }

        if (state->selectedBone) {
            state->dragStart = mousePos;
            state->originalHead = state->selectedBone->head;
            state->originalTail = state->selectedBone->tail;

            // 检测是否靠近端点
            double toHead = norm(mousePos - state->selectedBone->head);
            double toTail = norm(mousePos - state->selectedBone->tail);
            double threshold = 10.0;

            if (toHead < threshold) {
                state->mode = AppState::DRAG_HEAD;
            } else if (toTail < threshold) {
                state->mode = AppState::DRAG_TAIL;
            } else if (flags & EVENT_FLAG_CTRLKEY) {  // 按住Ctrl旋转
                state->mode = AppState::ROTATE;
                Point mid = (state->originalHead + state->originalTail) * 0.5;
                state->rotateCenter = mid;
                Point vecInit = state->dragStart - mid;
                state->initialAngle = atan2(vecInit.y, vecInit.x);
            } else {
                state->mode = AppState::TRANSLATE;
            }
        } else {
            // 添加新骨架（示例：固定长度）
            state->bones.emplace_back(mousePos, mousePos + Point(50,0), 10.0, Scalar(255,0,0));
        }
    }

    // 鼠标移动：更新位置
    else if (event == EVENT_MOUSEMOVE && state->selectedBone) {
        Point delta = mousePos - state->dragStart;

        switch (state->mode) {
        case AppState::DRAG_HEAD:
            state->selectedBone->head = state->originalHead + delta;
            break;
            
        case AppState::DRAG_TAIL:
            state->selectedBone->tail = state->originalTail + delta;
            break;
            
        case AppState::TRANSLATE:
            state->selectedBone->head = state->originalHead + delta;
            state->selectedBone->tail = state->originalTail + delta;
            break;
            
        case AppState::ROTATE: {
            Point vecCurrent = mousePos - state->rotateCenter;
            double currentAngle = atan2(vecCurrent.y, vecCurrent.x);
            double deltaAngle = currentAngle - state->initialAngle;
            
            state->selectedBone->head = rotatePoint(state->originalHead, state->rotateCenter, deltaAngle);
            state->selectedBone->tail = rotatePoint(state->originalTail, state->rotateCenter, deltaAngle);
            break;
        }
        }
    }

    // 鼠标释放：重置状态
    else if (event == EVENT_LBUTTONUP) {
        state->selectedBone = nullptr;
        state->mode = AppState::NONE;
    }
}

int main() {
    AppState state;
    Mat canvas(600, 800, CV_8UC3, Scalar(255,255,255));
    namedWindow("Bone Animation");

    // 初始化示例骨架
    state.bones.emplace_back(Point(100,200), Point(200,300), 10.0, Scalar(0,0,255));
    state.bones.emplace_back(Point(300,400), Point(400,300), 10.0, Scalar(0,255,0));

    setMouseCallback("Bone Animation", onMouse, &state);

    while (true) {
        canvas.setTo(Scalar(255,255,255));
        
        // 绘制所有骨架
        for (const auto& bone : state.bones) {
            line(canvas, bone.head, bone.tail, bone.color, 2);
            circle(canvas, bone.head, 5, Scalar(0,0,0), -1);  // 绘制端点
            circle(canvas, bone.tail, 5, Scalar(0,0,0), -1);
        }
        
        imshow("Bone Animation", canvas);
        if (waitKey(10) == 27) break;  // ESC退出
    }
    return 0;
}
