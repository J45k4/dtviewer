import { describe, expect, test } from "bun:test";
import type { DtsNode } from "./dts";
import { layoutTree, type ReferenceEdge } from "./layout";

const buildSyntheticTree = (fanout: number, depth: number) => {
    const root: DtsNode = {
        name: "<root>",
        fullName: "/",
        path: "/",
        properties: [],
        children: [],
    };

    const leaves: DtsNode[] = [];
    let totalNodes = 1;

    const createChildren = (parent: DtsNode, currentDepth: number, prefix: string) => {
        if (currentDepth >= depth) {
            leaves.push(parent);
            return;
        }
        for (let index = 0; index < fanout; index += 1) {
            const name = `node${currentDepth}_${index}`;
            const fullName = `${name}`;
            const path = parent.path === "/" ? `/${prefix}${name}` : `${parent.path}/${prefix}${name}`;
            const child: DtsNode = {
                name,
                fullName,
                path,
                properties: [],
                children: [],
            };
            parent.children.push(child);
            totalNodes += 1;
            createChildren(child, currentDepth + 1, `${prefix}${index}-`);
        }
    };

    createChildren(root, 0, "");

    const nodeLookup = new Map<string, DtsNode>();
    const collect = (node: DtsNode) => {
        nodeLookup.set(node.path, node);
        node.children.forEach(collect);
    };
    collect(root);

    const endpointPaths = new Set<string>();
    leaves.forEach((leaf) => endpointPaths.add(leaf.path));

    const referenceEdges: ReferenceEdge[] = [];
    if (leaves.length > 1) {
        leaves.forEach((leaf, index) => {
            const target = leaves[(index + Math.max(1, Math.floor(leaves.length / 7))) % leaves.length]!;
            referenceEdges.push({
                source: leaf.path,
                target: target.path,
                viaProperty: "remote-endpoint",
                kind: "phandle",
            });
        });
    }

    return { root, nodeLookup, endpointPaths, referenceEdges, totalNodes };
};

describe("layoutTree radial performance", () => {
    test("handles large synthetic trees within budget", () => {
        const { root, nodeLookup, endpointPaths, referenceEdges, totalNodes } = buildSyntheticTree(4, 5);

        const start = performance.now();
        const result = layoutTree(root, { referenceEdges, endpointPaths, nodeLookup });
        const duration = performance.now() - start;

        expect(result.nodes.length).toBeGreaterThanOrEqual(totalNodes);
        expect(duration).toBeLessThan(150);
    });
});
