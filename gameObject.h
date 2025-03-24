#ifndef GAMEOBJECT_H
#define GAMEOBJECT_H
#pragma once

#include <memory>
#include <string>
#include <vector>
#include "json.hpp"
#include <opencv2/opencv.hpp>

using json = nlohmann::json;
using namespace cv;
// Forward declarations
class Transform;
class Mesh;
class Bone;
class SpriteRenderer;
class AnimationController;

class GameObject;
// GameObject is the base class for all objects
class GameObject : public std::enable_shared_from_this<GameObject> {
public:
    std::shared_ptr<Transform> transform; // Coordinate transformation
    // Constructor
    GameObject(const std::string& name);
    // Static method to create shared_ptr
    static std::shared_ptr<GameObject> Create(const std::string& name);
    virtual ~GameObject() = default;
    virtual void Update(); // Update function
    std::string GetName() const {
        return name;
    }
    // Setter method
    void SetName(const std::string& newName) {
        name = newName;
    }
    void AddChild(std::shared_ptr<GameObject> child); // Add child object
    void RemoveChild(const std::string& childName); // Remove child object
    json GetHierarchyJson() const; // Get nested JSON of object relationships
    static std::shared_ptr<GameObject> FindByName(const std::string& name); // Find object by name

    // New: Register self to the global registry
    void RegisterSelf();
private:
    static std::unordered_map<std::string, std::weak_ptr<GameObject>> registry; // Global registry
    std::string name; // Object name
    std::weak_ptr<GameObject> parent; // Parent object (using weak_ptr to avoid circular references)
    std::vector<std::shared_ptr<GameObject>> children; // Child objects
};

// Transform is responsible for recording position, rotation, and scale
class Transform {
public:
    cv::Point2f position; // Position
    float rotation;       // Rotation angle
    cv::Point2f scale;    // Scale

    Transform();
};

// Mesh is responsible for recording mesh points
class Mesh {
public:
    std::vector<cv::Point2f> vertices; // Vertices
    std::vector<std::vector<int>> triangles; // Triangle indices

    Mesh();
    void LoadFromJson(const json& data); // Load mesh data from JSON
};

// Bone is responsible for recording skeleton information
class Bone : public GameObject {
public:
    std::weak_ptr<Bone> parentBone; // Parent bone
    std::vector<std::shared_ptr<Bone>> childBones; // Child bones

    cv::Point head;
    cv::Point tail;
    float thickness=5;
    Scalar color;
    // Constructor
    Bone(const std::string& name);
    Bone(Point h, Point t, float th, Scalar c);
    // Static method to create shared_ptr
    static std::shared_ptr<Bone> Create(const std::string& name);

    void setPoint(cv::Point head,cv::Point tail)
    {
        this->head=head;
        this->tail=tail;
    }
    void AddChildBone(std::shared_ptr<Bone> bone);
};

double distancePointToLine(const cv::Point& P, const cv::Point& A, const cv::Point& B);
cv::Point rotatePoint(const cv::Point& P, const cv::Point& C, double angle);
// SpriteRenderer is responsible for handling image data
class SpriteRenderer : public GameObject {
public:
    cv::Mat sprite; // Image data

    // Constructor
    SpriteRenderer(const std::string& name);

    // Static method to create shared_ptr
    static std::shared_ptr<SpriteRenderer> Create(const std::string& name);

    void LoadImage(const std::string& imagePath); // Load image
};

// AnimationController is responsible for controlling animation playback
class AnimationController : public GameObject {
public:
    std::vector<json> animationClips; // Animation clips (JSON format)

    // Constructor
    AnimationController(const std::string& name);

    // Static method to create shared_ptr
    static std::shared_ptr<AnimationController> Create(const std::string& name);

    void PlayAnimation(const std::string& clipName); // Play specified animation
};

/*
void testGameObject()
{

    std::cout<<" let's start ... "<<std::endl;

    auto root =  GameObject::Create("Root");
    auto child1 =  GameObject::Create("Child1");
    auto child2 =  GameObject::Create("Child2");
    auto grandChild = Bone::Create("GrandChild");

    // Establish object relationships
    root->AddChild(child1);
    root->AddChild(child2);
    child1->AddChild(grandChild);

    // Get nested JSON
    json hierarchyJson = root->GetHierarchyJson();

    std::cout << "Hierarchy JSON:\n" << hierarchyJson.dump(4) << std::endl;

    auto foundObject0 = GameObject::FindByName("Child1");
    if (foundObject0) {
        std::cout << "Found Object Name: " << foundObject0->GetName() << std::endl;
    } else {
        std::cout << "Object not found!" << std::endl;
    }

    auto foundObject = GameObject::FindByName("GrandChild");
    if (foundObject) {
        std::cout << "Found Object Name: " << foundObject->GetName() << std::endl;
    } else {
        std::cout << "Object not found!" << std::endl;
    }

    auto foundObject2 = GameObject::FindByName("haha");
    if (foundObject2) {
        std::cout << "Found Object Name: " << foundObject->GetName() << std::endl;
    } else {
        std::cout << "Object not found!" << std::endl;
    }
}
*/

#endif // GAMEOBJECT_H
