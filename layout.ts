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

    const visited = new Set<string>();
    const buildLayoutNode = (
        node: DtsNode,
        depth: number,
        portalSourcePath: string | null,
    ): LayoutNode => {
        visited.add(node.path);

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

        node.children.forEach((child) => {
            layoutNode.children.push(buildLayoutNode(child, depth + 1, null));
        });

        const portalTargets = portalTargetsBySource.get(node.path);
        if (portalTargets) {
            portalTargets.forEach((target) => {
                if (visited.has(target.path)) {
                    return;
                }
                layoutNode.children.push(buildLayoutNode(target, depth + 1, node.path));
            });
        }

        visited.delete(node.path);
        return layoutNode;
    };

    const rootLayout = buildLayoutNode(root, 0, null);

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

    const depthCounts = new Map<number, number>();
    const collectDepthCounts = (node: LayoutNode) => {
        depthCounts.set(node.depth, (depthCounts.get(node.depth) ?? 0) + 1);
        node.children.forEach(collectDepthCounts);
    };
    collectDepthCounts(rootLayout);

    const diagonalLength = Math.hypot(NODE_WIDTH + NODE_GAP, NODE_HEIGHT + NODE_GAP);

    const radiusByDepth = new Map<number, number>();
    radiusByDepth.set(0, 0);
    const depths = Array.from(depthCounts.keys()).sort((a, b) => a - b);
    depths.forEach((depth) => {
        if (depth === 0) {
            return;
        }
        const baseRadius = (radiusByDepth.get(depth - 1) ?? 0) + layerGap;
        const count = depthCounts.get(depth) ?? 0;
        let radius = baseRadius;
        if (count > 1) {
            const theta = (2 * Math.PI) / count;
            const sinHalf = Math.max(Math.sin(Math.min(Math.PI / 2, theta / 2)), 1e-6);
            const requiredRadius = diagonalLength / (2 * sinHalf);
            radius = Math.max(radius, requiredRadius);
        }
        radiusByDepth.set(depth, radius);
    });

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
        node.radius = radiusByDepth.get(node.depth) ?? node.depth * layerGap;
        updatePosition(node);

        if (!node.children.length) {
            return;
        }

        const span = endAngle - startAngle;
        const childRadius =
            radiusByDepth.get(node.depth + 1) ?? (node.depth + 1) * layerGap;
        const widthArc = childRadius > 0 ? NODE_WIDTH / childRadius : 0;
        const diagonalArc =
            childRadius > 0
                ? 2 *
                  Math.asin(
                      Math.min(
                          1,
                          Math.hypot(NODE_WIDTH + NODE_GAP, NODE_HEIGHT + NODE_GAP) /
                              Math.max(1, 2 * childRadius),
                      ),
                  )
                : 0;
        const baseArc = Math.max(widthArc, diagonalArc);
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

    const nodesByDepth = new Map<number, LayoutNode[]>();
    const buildDepthBuckets = (node: LayoutNode) => {
        const bucket = nodesByDepth.get(node.depth);
        if (bucket) {
            bucket.push(node);
        } else {
            nodesByDepth.set(node.depth, [node]);
        }
        node.children.forEach(buildDepthBuckets);
    };
    buildDepthBuckets(rootLayout);

    const requiredAngleForDepth = (depth: number) => {
        const radius = radiusByDepth.get(depth) ?? depth * layerGap;
        if (radius <= 0) {
            return Math.PI;
        }
        const ratio = Math.min(1, diagonalLength / Math.max(1, 2 * radius));
        return 2 * Math.asin(ratio);
    };

    const shiftSubtree = (node: LayoutNode, delta: number) => {
        if (delta === 0) {
            return;
        }
        const stack: LayoutNode[] = [node];
        while (stack.length) {
            const current = stack.pop()!;
            current.angle += delta;
            current.arcStart += delta;
            current.arcEnd += delta;
            current.radius = radiusByDepth.get(current.depth) ?? current.depth * layerGap;
            current.x = current.radius * Math.cos(current.angle) - NODE_WIDTH / 2;
            current.y = current.radius * Math.sin(current.angle);
            current.children.forEach((child) => stack.push(child));
        }
    };

    nodesByDepth.forEach((nodesAtDepth, depth) => {
        if (depth === 0) {
            return;
        }
        const required = requiredAngleForDepth(depth);
        const sorted = nodesAtDepth.sort((a, b) => a.angle - b.angle);
        const count = sorted.length;
        if (count <= 1) {
            return;
        }
        const unwrapped: number[] = new Array(count);
        unwrapped[0] = sorted[0]!.angle;
        for (let index = 1; index < count; index += 1) {
            let angle = sorted[index]!.angle;
            while (angle <= (unwrapped[index - 1] ?? angle)) {
                angle += 2 * Math.PI;
            }
            unwrapped[index] = angle;
        }
        const originalGaps: number[] = new Array(count);
        for (let index = 0; index < count - 1; index += 1) {
            originalGaps[index] = (unwrapped[index + 1] ?? 0) - (unwrapped[index] ?? 0);
        }
        originalGaps[count - 1] =
            (unwrapped[0] ?? 0) + 2 * Math.PI - (unwrapped[count - 1] ?? 0);
        const baseGap = required;
        const freeSpan = Math.max(0, 2 * Math.PI - baseGap * count);
        const totalOriginal =
            originalGaps.reduce((sum, gap) => sum + gap, 0) || 2 * Math.PI;
        const gapSizes = originalGaps.map(
            (gap) => baseGap + (freeSpan * gap) / totalOriginal,
        );
        const targetAngles: number[] = new Array(count);
        targetAngles[0] = 0;
        for (let index = 1; index < count; index += 1) {
            targetAngles[index] =
                (targetAngles[index - 1] ?? 0) + (gapSizes[index - 1] ?? baseGap);
        }
        const offset =
            sorted[0]!.angle - ((targetAngles[0] ?? 0) - Math.PI);
        for (let index = 0; index < count; index += 1) {
            const node = sorted[index]!;
            const desired = (targetAngles[index] ?? 0) - Math.PI + offset;
            const delta = desired - node.angle;
            if (Math.abs(delta) > 1e-9) {
                shiftSubtree(node, delta);
            }
        }
    });

    const recomputeArcBounds = (node: LayoutNode): { start: number; end: number } => {
        if (!node.children.length) {
            node.arcStart = node.angle;
            node.arcEnd = node.angle;
            return { start: node.arcStart, end: node.arcEnd };
        }
        let min = node.angle;
        let max = node.angle;
        node.children.forEach((child) => {
            const bounds = recomputeArcBounds(child);
            min = Math.min(min, bounds.start);
            max = Math.max(max, bounds.end);
        });
        node.arcStart = min;
        node.arcEnd = max;
        return { start: min, end: max };
    };

    recomputeArcBounds(rootLayout);

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
