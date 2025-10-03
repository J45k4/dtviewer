import { describe, expect, test } from "bun:test";
import type { DtsNode } from "./dts";
import {
	NODE_HEIGHT,
	NODE_WIDTH,
	layoutTree,
	type ReferenceEdge,
} from "./layout";

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

	const createChildren = (
		parent: DtsNode,
		currentDepth: number,
		prefix: string,
	) => {
		if (currentDepth >= depth) {
			leaves.push(parent);
			return;
		}
		for (let index = 0; index < fanout; index += 1) {
			const name = `node${currentDepth}_${index}`;
			const fullName = `${name}`;
			const path =
				parent.path === "/"
					? `/${prefix}${name}`
					: `${parent.path}/${prefix}${name}`;
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
			const target =
				leaves[
					(index + Math.max(1, Math.floor(leaves.length / 7))) %
						leaves.length
				]!;
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
		const { root, nodeLookup, endpointPaths, referenceEdges, totalNodes } =
			buildSyntheticTree(4, 5);

		const start = performance.now();
		const result = layoutTree(root, {
			referenceEdges,
			endpointPaths,
			nodeLookup,
		});
		const duration = performance.now() - start;

		expect(result.nodes.length).toBeGreaterThanOrEqual(totalNodes);
		expect(duration).toBeLessThan(150);
	});

	test("prevents overlapping node rectangles on each depth", () => {
		const { root, nodeLookup, endpointPaths, referenceEdges } =
			buildSyntheticTree(3, 4);
		const result = layoutTree(root, {
			referenceEdges,
			endpointPaths,
			nodeLookup,
		});

		const nodesByDepth = new Map<number, typeof result.nodes>();
		result.nodes.forEach((node) => {
			const list = nodesByDepth.get(node.depth);
			if (list) {
				list.push(node);
			} else {
				nodesByDepth.set(node.depth, [node]);
			}
		});

		const overlaps: string[] = [];
		const intersects = (
			a: (typeof result.nodes)[number],
			b: (typeof result.nodes)[number],
		) => {
			const aLeft = a.x;
			const aRight = a.x + NODE_WIDTH;
			const aTop = a.y - NODE_HEIGHT / 2;
			const aBottom = a.y + NODE_HEIGHT / 2;
			const bLeft = b.x;
			const bRight = b.x + NODE_WIDTH;
			const bTop = b.y - NODE_HEIGHT / 2;
			const bBottom = b.y + NODE_HEIGHT / 2;
			const horizontal = aLeft < bRight && aRight > bLeft;
			const vertical = aTop < bBottom && aBottom > bTop;
			return horizontal && vertical;
		};

		nodesByDepth.forEach((nodesAtDepth) => {
			for (let i = 0; i < nodesAtDepth.length; i += 1) {
				for (let j = i + 1; j < nodesAtDepth.length; j += 1) {
					if (intersects(nodesAtDepth[i]!, nodesAtDepth[j]!)) {
						overlaps.push(
							`${nodesAtDepth[i]!.node.path} overlaps ${nodesAtDepth[j]!.node.path}`,
						);
					}
				}
			}
		});

		expect(overlaps).toHaveLength(0);
	});
});
