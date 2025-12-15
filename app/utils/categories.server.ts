import fs from "fs";
import path from "path";

interface CategoryNode {
  id: string;
  name: string;
  children: CategoryNode[];
}

function parseCategories(fileContent: string): CategoryNode[] {
  const lines = fileContent.split("\n").filter(line => line.trim() !== "" && !line.startsWith("#"));
  const root: CategoryNode = { id: "root", name: "root", children: [] };

  lines.forEach(line => {
    const [gidPart, pathPart] = line.split(" : ");
    if (!gidPart || !pathPart) return;

    const id = gidPart.trim();
    const pathSegments = pathPart.split(" > ").map(segment => segment.trim());

    let currentNode = root;
    pathSegments.forEach((segment, index) => {
      let childNode = currentNode.children.find(child => child.name === segment);
      if (!childNode) {
        const isLeaf = index === pathSegments.length - 1;
        childNode = {
          id: isLeaf ? id : "", // Only assign ID to the leaf node
          name: segment,
          children: [],
        };
        currentNode.children.push(childNode);
      }
      currentNode = childNode;
      if (index === pathSegments.length - 1) {
        currentNode.id = id;
      }
    });
  });

  return root.children;
}

export function getProductCategories() {
  const filePath = path.resolve(process.cwd(), "categories.txt");
  const fileContent = fs.readFileSync(filePath, "utf-8");
  return parseCategories(fileContent);
}
