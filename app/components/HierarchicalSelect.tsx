import React, { useState, useEffect } from "react";
import { Select, BlockStack } from "@shopify/polaris";

interface CategoryNode {
  id: string;
  name: string;
  children: CategoryNode[];
}

interface HierarchicalSelectProps {
  categories: CategoryNode[];
  onChange: (selectedCategoryId: string) => void;
  path?: (string | null)[] | null;
}

export default function HierarchicalSelect({ categories, onChange, path }: HierarchicalSelectProps) {
  const [selectionPath, setSelectionPath] = useState<(string | null)[]>([null]);

  useEffect(() => {
    if (path && path.length > 0) {
      const newPath = [...path];
      const leafNode = findNode(categories, path.filter(p => p !== null) as string[]);
      if (leafNode && leafNode.children.length > 0) {
        newPath.push(null);
      }
      setSelectionPath(newPath);
    } else {
      setSelectionPath([null]);
    }
  }, [path, categories]);

  const handleSelectChange = (level: number, value: string) => {
    const newPath = selectionPath.slice(0, level + 1);
    newPath[level] = value;

    const selectedNode = findNode(categories, newPath.slice(0, level + 1) as string[]);
    
    console.log("HierarchicalSelect - Selected node:", selectedNode);
    console.log("HierarchicalSelect - Has children:", selectedNode?.children.length);
    
    if (selectedNode && selectedNode.children.length > 0) {
      newPath.push(null);
      console.log("HierarchicalSelect - Node has children, not calling onChange yet");
    } else if (selectedNode) {
      console.log("HierarchicalSelect - Leaf node selected, calling onChange with ID:", selectedNode.id);
      onChange(selectedNode.id);
    }

    setSelectionPath(newPath);
  };

  const findNode = (nodes: CategoryNode[], path: string[]): CategoryNode | undefined => {
    if (path.length === 0) return undefined;
    let currentNode: CategoryNode | undefined = { id: 'root', name: 'root', children: nodes };
    for (const segment of path) {
      if (!currentNode) return undefined;
      currentNode = currentNode.children.find(child => child.name === segment);
    }
    return currentNode;
  };

  const getOptionsForLevel = (level: number) => {
    if (level === 0) {
      return [{ label: "Choose a category", value: "" }, ...categories.map(c => ({ label: c.name, value: c.name }))];
    }
    const parentPath = selectionPath.slice(0, level).filter(s => s !== null) as string[];
    if (parentPath.length < level) return [];

    const parentNode = findNode(categories, parentPath);
    if (parentNode && parentNode.children) {
      return [{ label: `Choose a sub-category for ${parentNode.name}`, value: "" }, ...parentNode.children.map(c => ({ label: c.name, value: c.name }))];
    }
    return [];
  };

  return (
    <BlockStack gap="200">
      {selectionPath.map((selectedValue, level) => {
        const options = getOptionsForLevel(level);
        if (options.length === 0) return null;
        return (
          <Select
            key={level}
            label={level === 0 ? "Category" : ""}
            options={options}
            onChange={(value) => handleSelectChange(level, value)}
            value={selectedValue || ""}
          />
        );
      })}
    </BlockStack>
  );
}
