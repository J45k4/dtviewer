import type { DtsNode } from "./dts";

export type ReferenceEdge = {
    source: string;
    target: string;
    viaProperty: string;
    kind: "phandle" | "label";
};

export type LayoutNode = {
    node: DtsNode;
    depth: number;
    x: number;
    y: number;
    angle: number;
    radius: number;
    weight: number;
    portal: boolean;
    portalSourcePath: string | null;
    children: LayoutNode[];
    arcStart: number;
    arcEnd: number;
};

export type LayoutResult = {
    root: LayoutNode;
    nodes: LayoutNode[];
    bounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
    size: {
        width: number;
        height: number;
    };
    offset: {
        x: number;
        y: number;
    };
};

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 48;
export const NODE_GAP = 24;
export const CANVAS_PADDING = 48;
export const DEFAULT_RADIAL_LAYER_GAP = 220;

export type LayoutOptions = {
    referenceEdges?: ReferenceEdge[];
    endpointPaths?: Set<string>;
    nodeLookup?: Map<string, DtsNode>;
    layerGap?: number;
};

const collectAvailablePaths = (root: DtsNode): Set<string> => {
    const available = new Set<string>();
    const walk = (node: DtsNode) => {
        available.add(node.path);
        node.children.forEach(walk);
    };
    walk(root);
    return available;
};

export const layoutTree = (
    root: DtsNode,
    options: LayoutOptions = {},
): LayoutResult => {
    const layerGap = options.layerGap ?? DEFAULT_RADIAL_LAYER_GAP;
    const referenceEdges = options.referenceEdges ?? [];
    const endpointPaths = options.endpointPaths ?? new Set<string>();
    const nodeLookup = options.nodeLookup ?? new Map<string, DtsNode>();

    const availablePaths = collectAvailablePaths(root);

    const portalTargetsBySource = new Map<string, DtsNode[]>();

    referenceEdges.forEach((edge) => {
        if (!availablePaths.has(edge.source)) {
            return;
        }
        const targetNode = nodeLookup.get(edge.target);
        if (!targetNode) {
            return;
        }
        if (!endpointPaths.has(targetNode.path)) {
            return;
        }
        if (availablePaths.has(targetNode.path)) {
            return;
        }
        const list = portalTargetsBySource.get(edge.source);
        if (list) {
            if (!list.some((entry) => entry.path === targetNode.path)) {
                list.push(targetNode);
            }
        } else {
            portalTargetsBySource.set(edge.source, [targetNode]);
        }
    });

    const buildLayoutNode = (
        node: DtsNode,
        depth: number,
        portalSourcePath: string | null,
        visited: Set<string>,
    ): LayoutNode => {
        const branchVisited = new Set(visited);
        branchVisited.add(node.path);

        const layoutNode: LayoutNode = {
            node,
            depth,
            x: 0,
            y: 0,
            angle: 0,
            radius: depth * layerGap,
            weight: 1,
            portal: portalSourcePath !== null,
            portalSourcePath,
            children: [],
            arcStart: 0,
            arcEnd: 0,
        };

        const realChildren = node.children.map((child) =>
            buildLayoutNode(child, depth + 1, null, branchVisited),
        );

        const portalChildren: LayoutNode[] = [];
        const portalTargets = portalTargetsBySource.get(node.path) ?? [];
        portalTargets.forEach((target) => {
            if (branchVisited.has(target.path)) {
                return;
            }
            const portalVisited = new Set(branchVisited);
            portalVisited.add(target.path);
            const portalNode = buildLayoutNode(target, depth + 1, node.path, portalVisited);
            portalNode.portal = true;
            portalNode.portalSourcePath = node.path;
            portalChildren.push(portalNode);
        });

        layoutNode.children = [...realChildren, ...portalChildren];
        return layoutNode;
    };

    const rootLayout = buildLayoutNode(root, 0, null, new Set());

    const computeWeights = (node: LayoutNode): number => {
        if (!node.children.length) {
            node.weight = 1;
            return node.weight;
        }
        let total = 0;
        node.children.forEach((child) => {
            total += computeWeights(child);
        });
        node.weight = Math.max(total, 1);
        return node.weight;
    };

    computeWeights(rootLayout);

    const updatePosition = (node: LayoutNode) => {
        node.x = node.radius * Math.cos(node.angle) - NODE_WIDTH / 2;
        node.y = node.radius * Math.sin(node.angle);
    };

    const assignAngles = (node: LayoutNode, startAngle: number, endAngle: number) => {
        if (node.depth === 0) {
            node.angle = 0;
        } else {
            node.angle = (startAngle + endAngle) / 2;
        }
        node.arcStart = startAngle;
        node.arcEnd = endAngle;
        node.radius = node.depth * layerGap;
        updatePosition(node);

        if (!node.children.length) {
            return;
        }

        const span = endAngle - startAngle;
        const childRadius = (node.depth + 1) * layerGap;
        const baseArc = childRadius > 0 ? NODE_WIDTH / childRadius : 0;
        const gapArc = childRadius > 0 ? NODE_GAP / childRadius : 0;
        const childCount = node.children.length;
        const minSpan = baseArc * childCount + gapArc * (childCount + 1);
        let workingStart = startAngle;
        let workingEnd = endAngle;
        if (span < minSpan) {
            const expansion = (minSpan - span) / 2;
            workingStart -= expansion;
            workingEnd += expansion;
        }
        const workingSpan = workingEnd - workingStart;
        const freeSpan = Math.max(0, workingSpan - minSpan);
        const totalWeight = node.children.reduce((sum, child) => sum + (child.weight || 1), 0);
        const safeTotal = totalWeight === 0 ? childCount || 1 : totalWeight;
        let cursor = workingStart + gapArc;
        node.children.forEach((child) => {
            const portion = (child.weight || 1) / safeTotal;
            const extra = freeSpan * portion;
            const childSpan = baseArc + extra;
            const childStart = cursor;
            const childEnd = childStart + childSpan;
            assignAngles(child, childStart, childEnd);
            cursor = childEnd + gapArc;
        });
    };

    assignAngles(rootLayout, -Math.PI, Math.PI);

    const nodes: LayoutNode[] = [];
    const collectNodes = (node: LayoutNode) => {
        nodes.push(node);
        node.children.forEach(collectNodes);
    };
    collectNodes(rootLayout);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    nodes.forEach((node) => {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x + NODE_WIDTH);
        minY = Math.min(minY, node.y - NODE_HEIGHT / 2);
        maxY = Math.max(maxY, node.y + NODE_HEIGHT / 2);
    });

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
        minX = -NODE_WIDTH / 2;
        maxX = NODE_WIDTH / 2;
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
        minY = -NODE_HEIGHT / 2;
        maxY = NODE_HEIGHT / 2;
    }

    const bounds = { minX, maxX, minY, maxY };
    const width = Math.max(1, maxX - minX + CANVAS_PADDING * 2);
    const height = Math.max(1, maxY - minY + CANVAS_PADDING * 2);
    const offset = {
        x: CANVAS_PADDING - minX,
        y: CANVAS_PADDING - minY,
    };

    return {
        root: rootLayout,
        nodes,
        bounds,
        size: { width, height },
        offset,
    };
};
