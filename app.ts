import { dtsPare } from "./dts";
import type { DtsNode, DtsValue } from "./dts";

type LayoutNode = {
	node: DtsNode;
	depth: number;
	x: number;
	y: number;
	children: LayoutNode[];
};

const HORIZONTAL_SPACING = 220;
const VERTICAL_SPACING = 96;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;
const CANVAS_PADDING = 48;

const fileInput = document.querySelector<HTMLInputElement>("#dts-input");
const sampleButton = document.querySelector<HTMLButtonElement>("#load-sample");
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const canvas = document.querySelector<HTMLCanvasElement>("#viewer-canvas");
const dropOverlay = document.querySelector<HTMLDivElement>("#drop-overlay");
const detailsTitle = document.querySelector<HTMLHeadingElement>("#details-title");
const detailsContent = document.querySelector<HTMLDivElement>("#details-content");
const searchForm = document.querySelector<HTMLFormElement>("#search-form");
const searchInput = document.querySelector<HTMLInputElement>("#search-input");
const searchClear = document.querySelector<HTMLButtonElement>("#search-clear");
const searchSummary = document.querySelector<HTMLParagraphElement>("#search-summary");

const ctx = canvas?.getContext("2d");

const SAMPLE_DTS = `
/ {
	model = "Sample i.MX8 Board";
	chosen {
		bootargs = "console=ttyS0,115200";
	};

	usb@32f10108 {
		compatible = "fsl,imx8mp-dwc3";
		phandle = <0x83>;
		clocks = <0x2 0x10c 0x2 0x140>;
		clock-names = "hsio", "suspend";
		interrupts = <0x0 0x95 0x4>;
		ranges;
		status = "okay";

		usb@38200000 {
			compatible = "snps,dwc3";
			phys = <0x83 0x83>;
			phy-names = "usb2-phy", "usb3-phy";
			dr_mode = "host";
			status = "okay";
		};
	};

	ldb-display-controller {
		lvds-channel@0 {
			port@0 {
				endpoint {
					remote-endpoint = <0x85>;
					phandle = <0x5f>;
				};
			};

			port@1 {
				endpoint {
					remote-endpoint = <0x86>;
					phandle = <0xa2>;
				};
			};
		};
	};
};
`;

type LayoutResult = {
	root: LayoutNode;
	nodes: LayoutNode[];
	maxDepth: number;
	maxY: number;
	rowCount: number;
};

let currentLayout: LayoutResult | null = null;
let currentRoot: DtsNode | null = null;
let selectedNodePath: string | null = null;
let activeFilterRaw = "";
let activeFilterNormalized = "";
let filteredLayout: LayoutResult | null = null;
let filteredNodes: LayoutNode[] = [];

const truncate = (value: string, max = 32): string => {
	if (value.length <= max) {
		return value;
	}
	return `${value.slice(0, max - 1)}…`;
};

const countNodes = (node: DtsNode): number =>
	1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object";

const formatValue = (value: DtsValue): string => {
	const formatInner = (input: unknown): string => {
		if (Array.isArray(input)) {
			return `[${input.map((item) => formatInner(item)).join(", ")}]`;
		}

		if (isRecord(input)) {
			if ("ref" in input && typeof input.ref === "string") {
				return `&${input.ref}`;
			}
			if (Array.isArray(input.bytes)) {
				return (input.bytes as number[])
					.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`)
					.join(" ");
			}
		}

		switch (typeof input) {
			case "string":
				return `"${input}"`;
			case "number":
				return input >= 10 ? `0x${input.toString(16)}` : String(input);
			case "boolean":
				return input ? "true" : "false";
			default:
				return String(input ?? "");
		}
	};

	return formatInner(value);
};

const appendMetaRow = (
	container: HTMLDListElement,
	label: string,
	value: string | number | undefined,
) => {
	if (value === undefined || value === "") {
		return;
	}
	const dt = document.createElement("dt");
	dt.textContent = label;
	const dd = document.createElement("dd");
	dd.textContent = String(value);
	container.append(dt, dd);
};

const renderDetails = (node: DtsNode | null) => {
	if (!detailsContent || !detailsTitle) {
		return;
	}

	detailsContent.innerHTML = "";

	if (!node) {
		detailsTitle.textContent = "Node details";
		const placeholder = document.createElement("p");
		placeholder.textContent = "Click any node in the tree to inspect its attributes and properties.";
		detailsContent.append(placeholder);
		return;
	}

	const isRoot = node.path === "/";
	detailsTitle.textContent = isRoot ? "Root node" : node.fullName;

	const meta = document.createElement("dl");
	appendMetaRow(meta, "Path", node.path);
	appendMetaRow(meta, "Label", node.label);
	appendMetaRow(meta, "Unit address", node.unitAddress);
	appendMetaRow(meta, "Children", node.children.length);
	appendMetaRow(meta, "Properties", node.properties.length);
	detailsContent.append(meta);

	if (!node.properties.length) {
		const empty = document.createElement("p");
		empty.textContent = "This node has no explicit properties.";
		detailsContent.append(empty);
		return;
	}

	const table = document.createElement("table");
	const thead = document.createElement("thead");
	const headerRow = document.createElement("tr");
	["Name", "Type", "Value"].forEach((label) => {
		const cell = document.createElement("th");
		cell.textContent = label;
		headerRow.append(cell);
	});
	thead.append(headerRow);
	table.append(thead);

	const tbody = document.createElement("tbody");
	node.properties.forEach((property) => {
		const row = document.createElement("tr");
		const nameCell = document.createElement("td");
		nameCell.textContent = property.name;
		const typeCell = document.createElement("td");
		typeCell.textContent = property.type;
		const valueCell = document.createElement("td");
		valueCell.textContent = formatValue(property.value);
		row.append(nameCell, typeCell, valueCell);
		tbody.append(row);
	});

	table.append(tbody);
	detailsContent.append(table);
};

const updateStatus = (
	origin: string,
	nodeCount: number,
	errors: string[],
	warnings: string[],
) => {
	if (!statusElement) {
		return;
	}

	statusElement.classList.remove("error", "warning");

	const lines: string[] = [
		`${origin} – ${nodeCount} node${nodeCount === 1 ? "" : "s"}`,
	];

	if (warnings.length) {
		statusElement.classList.add("warning");
		lines.push(`Warnings (x${warnings.length}):`);
		lines.push(...warnings.map((w) => `• ${w}`));
	}

	if (errors.length) {
		statusElement.classList.add("error");
		lines.push(`Errors (x${errors.length}):`);
		lines.push(...errors.map((e) => `• ${e}`));
	}

	statusElement.textContent = lines.join("\n");
};

const layoutTree = (root: DtsNode): LayoutResult => {
	const nextRow = { value: 0 };

	const layoutNode = (node: DtsNode, depth: number): LayoutNode => {
		const base: LayoutNode = {
			node,
			depth,
			x: depth * HORIZONTAL_SPACING,
			y: 0,
			children: [],
		};

		const children = node.children.map((child) => layoutNode(child, depth + 1));
		base.children = children;

		if (children.length === 0) {
			base.y = nextRow.value * VERTICAL_SPACING + NODE_HEIGHT / 2;
			nextRow.value += 1;
		} else {
			const first = children[0]!;
			const last = children[children.length - 1]!;
			base.y = (first.y + last.y) / 2;
		}

		return base;
	};

	const rootLayout = layoutNode(root, 0);
	const ordered: LayoutNode[] = [];
	const collect = (node: LayoutNode) => {
		ordered.push(node);
		node.children.forEach(collect);
	};
	collect(rootLayout);

	const maxDepth = ordered.reduce((acc, item) => Math.max(acc, item.depth), 0);
	const maxY = ordered.reduce((acc, item) => Math.max(acc, item.y), NODE_HEIGHT);

	return {
		root: rootLayout,
		nodes: ordered,
		maxDepth,
		maxY,
		rowCount: Math.max(nextRow.value, 1),
	};
};

const prepareCanvas = (width: number, height: number) => {
	if (!canvas || !ctx) {
		return;
	}

	const ratio = window.devicePixelRatio ?? 1;
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	canvas.width = Math.max(Math.floor(width * ratio), 1);
	canvas.height = Math.max(Math.floor(height * ratio), 1);
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	ctx.clearRect(0, 0, width, height);
	ctx.translate(CANVAS_PADDING, CANVAS_PADDING);
};

const renderLayout = (layout: LayoutResult, selectedPath: string | null) => {
	if (!canvas || !ctx) {
		return;
	}

	const width = (layout.maxDepth + 1) * HORIZONTAL_SPACING + NODE_WIDTH + CANVAS_PADDING * 2;
	const height = layout.maxY + NODE_HEIGHT / 2 + CANVAS_PADDING * 2;

	prepareCanvas(width, height);

	ctx.save();
	ctx.lineWidth = 1.4;
	ctx.strokeStyle = "rgba(80, 80, 90, 0.6)";

	layout.nodes.forEach((node) => {
		const parentCenterX = node.x + NODE_WIDTH / 2;
		const parentCenterY = node.y;
		node.children.forEach((child) => {
			const childCenterX = child.x + NODE_WIDTH / 2;
			const childCenterY = child.y;

			ctx.beginPath();
			ctx.moveTo(parentCenterX, parentCenterY);
			ctx.lineTo(childCenterX, childCenterY);
			ctx.stroke();
		});
	});

	ctx.restore();

	ctx.save();
	ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";

	layout.nodes.forEach((node) => {
		const x = node.x;
		const y = node.y - NODE_HEIGHT / 2;
		const isSelected = selectedPath === node.node.path;

		ctx.fillStyle = isSelected ? "rgba(59, 130, 246, 0.92)" : "rgba(255, 255, 255, 0.94)";
		ctx.strokeStyle = isSelected ? "rgba(29, 78, 216, 0.95)" : "rgba(60, 60, 70, 0.8)";
		ctx.lineWidth = isSelected ? 2 : 1.2;
		ctx.beginPath();
		ctx.roundRect(x, y, NODE_WIDTH, NODE_HEIGHT, 10);
		ctx.fill();
		ctx.stroke();

		const label = node.node.label
			? `${node.node.label}: ${node.node.fullName}`
			: node.node.fullName;
		const subtitle = `children: ${node.node.children.length}  props: ${node.node.properties.length}`;

		ctx.fillStyle = isSelected ? "#f8fafc" : "#111827";
		ctx.fillText(truncate(label, 28), x + 12, node.y - 10);

		ctx.fillStyle = isSelected ? "#e5e7eb" : "#4b5563";
		ctx.fillText(truncate(subtitle, 30), x + 12, node.y + 10);
	});

	ctx.restore();
};

const displayTree = (source: string, origin: string) => {
	if (!canvas || !ctx || !statusElement) {
		console.error("Viewer not initialised");
		return;
	}

	const result = dtsPare(source);
	const nodeCount = countNodes(result.root);

	updateStatus(origin, nodeCount, result.errors, result.warnings);

	if (nodeCount === 0) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		currentLayout = null;
		selectedNodePath = null;
		renderDetails(null);
		return;
	}

	currentRoot = result.root;
	currentLayout = layoutTree(result.root);
	selectedNodePath = null;
	activeFilterRaw = "";
	activeFilterNormalized = "";
	renderDetails(null);
	if (canvas) {
		canvas.style.cursor = "default";
	}
	filteredLayout = null;
	filteredNodes = [];
	if (searchInput) {
		searchInput.value = "";
	}
	updateSearchSummary("", 0);
	renderLayout(currentLayout, selectedNodePath);
};

const getLogicalPoint = (event: MouseEvent) => {
	if (!canvas) {
		return null;
	}
	const rect = canvas.getBoundingClientRect();
	const x = event.clientX - rect.left - CANVAS_PADDING;
	const y = event.clientY - rect.top - CANVAS_PADDING;
	return { x, y };
};

const pickNodeAt = (x: number, y: number): LayoutNode | null => {
	if (!currentLayout) {
		return null;
	}
	return (
		currentLayout.nodes.find(
			(node) =>
				x >= node.x &&
				x <= node.x + NODE_WIDTH &&
				y >= node.y - NODE_HEIGHT / 2 &&
				y <= node.y + NODE_HEIGHT / 2,
		) ?? null
	);
};

const pickNodeFromEvent = (event: MouseEvent): LayoutNode | null => {
	const point = getLogicalPoint(event);
	if (!point) {
		return null;
	}
	if (point.x < 0 || point.y < 0) {
		return null;
	}
	return pickNodeAt(point.x, point.y);
};

const selectLayoutNode = (layoutNode: LayoutNode) => {
	selectedNodePath = layoutNode.node.path;
	renderDetails(layoutNode.node);
	const layoutToRender = filteredLayout ?? currentLayout;
	if (layoutToRender) {
		renderLayout(layoutToRender, selectedNodePath);
	}
};

const updateSearchSummary = (query: string, matchCount: number) => {
	if (!searchSummary) {
		return;
	}
	if (!query) {
		searchSummary.textContent = "";
		return;
	}
	if (matchCount === 0) {
		searchSummary.textContent = `No matches for "${query}"`;
		return;
	}
	const suffix = matchCount === 1 ? "match" : "matches";
	searchSummary.textContent = `${matchCount} ${suffix}`;
};

const normalizeFilter = (query: string) => query.trim().toLowerCase();

const nodeMatchesNormalized = (node: DtsNode, normalized: string): boolean => {
	if (!normalized) {
		return true;
	}
	const haystacks = [
		node.fullName,
		node.path,
		node.label ?? "",
		node.unitAddress ?? "",
		...node.properties.flatMap((prop) => [prop.name, formatValue(prop.value)]),
	];
	return haystacks.some((text) => text.toLowerCase().includes(normalized));
};

const filterDtsTree = (node: DtsNode, normalized: string): DtsNode | null => {
	if (!normalized) {
		return node;
	}

	const filteredChildren = node.children
		.map((child) => filterDtsTree(child, normalized))
		.filter((child): child is DtsNode => child !== null);

	const matchesSelf = nodeMatchesNormalized(node, normalized);

	if (!matchesSelf && filteredChildren.length === 0) {
		return null;
	}

	const unchangedChildren =
		filteredChildren.length === node.children.length &&
		filteredChildren.every((child, index) => child === node.children[index]);

	if (matchesSelf && unchangedChildren) {
		return node;
	}

	return {
		...node,
		children: filteredChildren,
	};
};

const applyFilter = (root: DtsNode | null, normalized: string): LayoutResult | null => {
	if (!root || !normalized) {
		return null;
	}

	const filteredRoot = filterDtsTree(root, normalized);
	if (!filteredRoot) {
		return null;
	}

	return layoutTree(filteredRoot);
};

const handleFileSelection = async (file: File) => {
	const contents = await file.text();
	displayTree(contents, `File: ${file.name}`);
};

const attachEventHandlers = () => {
	if (fileInput) {
		fileInput.addEventListener("change", async () => {
			const file = fileInput.files?.[0];
			if (!file) {
				return;
			}

			try {
				await handleFileSelection(file);
			} catch (error) {
				updateStatus(
					`File: ${file.name}`,
					0,
					[error instanceof Error ? error.message : String(error)],
					[],
				);
			} finally {
				fileInput.value = "";
			}
		});
	}

	sampleButton?.addEventListener("click", () => {
		displayTree(SAMPLE_DTS, "Sample DTS");
	});

	if (canvas) {
		canvas.addEventListener("click", (event) => {
			const hit = pickNodeFromEvent(event);
			if (hit) {
				selectLayoutNode(hit);
			}
		});

		canvas.addEventListener("mousemove", (event) => {
			const hit = pickNodeFromEvent(event);
			if (!canvas) {
				return;
			}
			canvas.style.cursor = hit ? "pointer" : "default";
		});

		canvas.addEventListener("mouseleave", () => {
			if (canvas) {
				canvas.style.cursor = "default";
			}
		});
	}

	const applySearch = (query: string) => {
		activeFilterRaw = query;
		activeFilterNormalized = normalizeFilter(query);
		filteredLayout = applyFilter(currentRoot, activeFilterNormalized);
		filteredNodes = filteredLayout?.nodes ?? [];

		if (activeFilterNormalized) {
			const existingSelection =
				selectedNodePath &&
				filteredNodes.find((node) => node.node.path === selectedNodePath);

			if (!existingSelection && filteredNodes.length > 0) {
				const firstMatch =
					filteredNodes.find((node) =>
						nodeMatchesNormalized(node.node, activeFilterNormalized),
					) ?? filteredNodes[0]!;
				selectedNodePath = firstMatch.node.path;
				renderDetails(firstMatch.node);
			} else if (!existingSelection && filteredNodes.length === 0) {
				selectedNodePath = null;
				renderDetails(null);
			}
		} else if (selectedNodePath) {
			const baseNode = currentLayout?.nodes.find(
				(node) => node.node.path === selectedNodePath,
			);
			if (!baseNode) {
				selectedNodePath = null;
				renderDetails(null);
			}
		} else {
			renderDetails(null);
		}

		const layoutToRender = filteredLayout ?? currentLayout;
		if (layoutToRender) {
			renderLayout(layoutToRender, selectedNodePath);
		}

		updateSearchSummary(activeFilterRaw.trim(), filteredNodes.length);
	};

	const clearSearch = () => {
		activeFilterRaw = "";
		activeFilterNormalized = "";
		filteredLayout = null;
		filteredNodes = [];
		selectedNodePath = null;
		renderDetails(null);
		if (currentLayout) {
			renderLayout(currentLayout, selectedNodePath);
		}
		updateSearchSummary("", 0);
	};

	searchForm?.addEventListener("submit", (event) => {
		event.preventDefault();
		applySearch(searchInput?.value ?? "");
	});

	searchInput?.addEventListener("input", () => {
		applySearch(searchInput.value);
	});

	searchClear?.addEventListener("click", () => {
		if (searchInput) {
			searchInput.value = "";
		}
		clearSearch();
	});

	const dragState = {
		enterDepth: 0,
	};

	const hasFiles = (event: DragEvent) =>
		Array.from(event.dataTransfer?.types ?? []).includes("Files");

	const showOverlay = () => {
		dropOverlay?.classList.add("visible");
	};

	const hideOverlay = () => {
		dragState.enterDepth = 0;
		dropOverlay?.classList.remove("visible");
	};

	window.addEventListener("dragenter", (event) => {
		if (!hasFiles(event)) {
			return;
		}
		event.preventDefault();
		dragState.enterDepth += 1;
		showOverlay();
	});

	window.addEventListener("dragover", (event) => {
		if (!hasFiles(event)) {
			return;
		}
		event.preventDefault();
		event.dataTransfer!.dropEffect = "copy";
		showOverlay();
	});

	window.addEventListener("dragleave", (event) => {
		if (!hasFiles(event)) {
			return;
		}
		dragState.enterDepth = Math.max(0, dragState.enterDepth - 1);
		if (dragState.enterDepth === 0) {
			hideOverlay();
		}
	});

	window.addEventListener("dragend", () => {
		hideOverlay();
	});

	window.addEventListener("drop", async (event) => {
		event.preventDefault();
		hideOverlay();

		const files = event.dataTransfer?.files;
		if (!files || files.length === 0) {
			updateStatus("Drop", 0, ["No file found in drop payload"], []);
			return;
		}

		const file = files.item(0);
		if (!file) {
			updateStatus("Drop", 0, ["Unable to read dropped file"], []);
			return;
		}

		try {
			await handleFileSelection(file);
		} catch (error) {
			updateStatus(
				`Dropped: ${file.name}`,
				0,
				[error instanceof Error ? error.message : String(error)],
				[],
			);
		}
	});
};

if (!ctx) {
	statusElement?.classList.add("error");
	statusElement?.append("\nCanvas rendering context unavailable in this browser.");
} else {
	attachEventHandlers();
}
