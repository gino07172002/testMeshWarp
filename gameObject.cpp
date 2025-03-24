#include "gameObject.h"
#include <iostream>

// Initialize static registry
std::unordered_map<std::string, std::weak_ptr<GameObject>> GameObject::registry;

// GameObject implementation
GameObject::GameObject(const std::string& name) : name(name) {
    std::cout << "make name : " << name << std::endl;
    // Do not call weak_from_this() in the constructor
}

// New method: Register self to the global registry
void GameObject::RegisterSelf() {
    std::uintptr_t address = reinterpret_cast<std::uintptr_t>(this);
    std::cout << " hi regist address: " << address << " is " << name << std::endl;
    registry[name] = weak_from_this(); // Now the object is managed by shared_ptr
}

std::shared_ptr<GameObject> GameObject::Create(const std::string& name) {
    auto gameObject = std::make_shared<GameObject>(name);
    gameObject->RegisterSelf(); // Register after creating shared_ptr
    return gameObject;
}

void GameObject::AddChild(std::shared_ptr<GameObject> child) {
    child->parent = shared_from_this(); // Set parent object
    children.push_back(child); // Add to children list
}

void GameObject::RemoveChild(const std::string& childName) {
    auto it = std::remove_if(children.begin(), children.end(),
        [&childName](const std::shared_ptr<GameObject>& child) {
            return child->GetName() == childName;
        });
    if (it != children.end()) {
        children.erase(it, children.end()); // Remove from children list
    }
}

json GameObject::GetHierarchyJson() const {
    json result;
    result["name"] = name;
    // Recursively process child objects
    if (!children.empty()) {
        result["children"] = json::array();
        for (const auto& child : children) {
            result["children"].push_back(child->GetHierarchyJson());
        }
    }
    return result;
}

std::shared_ptr<GameObject> GameObject::FindByName(const std::string& name) {
    auto it = registry.find(name);
    if (it != registry.end()) {
        std::cout << " I found : " << name << std::endl;
        return it->second.lock(); // Return the found object (check validity)
    }
    return nullptr; // Return nullptr if not found
}

void GameObject::Update() {
    std::cout << "Updating GameObject: " << name << std::endl;
}

// Transform implementation
Transform::Transform() : position(0, 0), rotation(0.0f), scale(1.0f, 1.0f) {}

// Mesh implementation
Mesh::Mesh() {}

void Mesh::LoadFromJson(const json& data) {
    if (data.count("vertices")) {
        for (const auto& vertex : data["vertices"]) {
            vertices.emplace_back(vertex[0], vertex[1]);
        }
    }
    if (data.count("triangles")) {
        for (const auto& triangle : data["triangles"]) {
            std::vector<int> indices = { triangle[0], triangle[1], triangle[2] };
            triangles.push_back(indices);
        }
    }
}

// Bone implementation
Bone::Bone(const std::string& name) : GameObject(name) {}

Bone::Bone(Point h, Point t, float th, Scalar c) : GameObject("newBone"),head(h), tail(t), thickness(th), color(c) {}

std::shared_ptr<Bone> Bone::Create(const std::string& name) {
    return std::make_shared<Bone>(name);
}

void Bone::AddChildBone(std::shared_ptr<Bone> bone) {
    childBones.push_back(bone);
    bone->parentBone = std::static_pointer_cast<Bone>(shared_from_this());
}

// SpriteRenderer implementation
SpriteRenderer::SpriteRenderer(const std::string& name) : GameObject(name) {}

std::shared_ptr<SpriteRenderer> SpriteRenderer::Create(const std::string& name) {
    return std::make_shared<SpriteRenderer>(name);
}

void SpriteRenderer::LoadImage(const std::string& imagePath) {
    sprite = cv::imread(imagePath, cv::IMREAD_COLOR);
    if (sprite.empty()) {
        std::cerr << "Failed to load image: " << imagePath << std::endl;
    }
    else {
        std::cout << "Image loaded successfully: " << imagePath << std::endl;
    }
}

// AnimationController implementation
AnimationController::AnimationController(const std::string& name) : GameObject(name) {}

std::shared_ptr<AnimationController> AnimationController::Create(const std::string& name) {
    return std::make_shared<AnimationController>(name);
}

void AnimationController::PlayAnimation(const std::string& clipName) {
    std::cout << "Playing animation: " << clipName << std::endl;
    // TODO: Implement animation playback logic
}

//bone control

double distancePointToLine(const cv::Point& P, const cv::Point& A, const cv::Point& B)
{
    Point AB = B - A;
    Point AP = P - A;

    double abLengthSq = AB.x*AB.x + AB.y*AB.y;
    if (abLengthSq == 0) return norm(AP);  // A和B重合

    double t = (AP.x*AB.x + AP.y*AB.y) / abLengthSq;
    t = max(0.0, min(1.0, t));

    Point projection = A + t * AB;
    return norm(P - projection);
}
cv::Point rotatePoint(const cv::Point& P, const cv::Point& C, double angle)
{
    Point translated = P - C;
    double cosA = cos(angle);
    double sinA = sin(angle);
    return Point(
        round(translated.x*cosA - translated.y*sinA + C.x),
        round(translated.x*sinA + translated.y*cosA + C.y)
    );
}
