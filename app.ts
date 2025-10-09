import { dtsPare } from "./dts";
import type { DtsNode, DtsProperty, DtsValue } from "./dts";
import { createRegisterMap, type RegisterMapController } from "./register-map";
import {
	CANVAS_PADDING,
	NODE_GAP,
	NODE_HEIGHT,
	NODE_WIDTH,
	layoutTree as radialLayout,
	type LayoutNode,
	type LayoutResult,
	type ReferenceEdge,
} from "./layout";

type StatusFilter = "all" | "okay" | "disabled";

const fileInput = document.querySelector<HTMLInputElement>("#dts-input");
const sampleButton = document.querySelector<HTMLButtonElement>("#load-sample");
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const canvas = document.querySelector<HTMLCanvasElement>("#viewer-canvas");
const dropOverlay = document.querySelector<HTMLDivElement>("#drop-overlay");
const viewerWrapper = document.querySelector<HTMLDivElement>("#viewer-wrapper");
const detailsTitle =
	document.querySelector<HTMLHeadingElement>("#details-title");
const detailsContent =
	document.querySelector<HTMLDivElement>("#details-content");
const searchForm = document.querySelector<HTMLFormElement>("#search-form");
const searchInput = document.querySelector<HTMLInputElement>("#search-input");
const searchClear = document.querySelector<HTMLButtonElement>("#search-clear");
const searchSummary =
	document.querySelector<HTMLParagraphElement>("#search-summary");
const statusFilterSelect =
	document.querySelector<HTMLSelectElement>("#status-filter");
const warningsToggle =
	document.querySelector<HTMLInputElement>("#warnings-checkbox");
const warningsToggleLabel = document.querySelector<HTMLLabelElement>(
	"#warnings-toggle-label",
);
const warningsPanel = document.querySelector<HTMLPreElement>("#warnings-panel");
const registerMapPanel = document.querySelector<HTMLElement>("#register-map-panel");
const registerMapToggle = document.querySelector<HTMLButtonElement>(
        "#register-map-toggle",
);
const registerMapStatus = document.querySelector<HTMLParagraphElement>(
        "#register-map-status",
);
const registerMapTrack = document.querySelector<HTMLDivElement>(
        "#register-map-track",
);
const registerMapLegend = document.querySelector<HTMLDivElement>(
        "#register-map-legend",
);
const registerMapAxis =
        document.querySelector<HTMLDivElement>("#register-map-axis");

const ctx = canvas?.getContext("2d");

const SAMPLE_DTS = (() => {
	const lines: string[] = [
		"/ {",
		'        model = "Sample i.MX8 Board";',
		'        compatible = "fsl,imx8mp";',
		"",
		"        chosen {",
		'                bootargs = "console=ttyS0,115200 earlycon";',
		"                stdout-path = &uart3;",
		"        };",
		"",
		"        aliases {",
		"                ethernet0 = &fec1;",
		"                i2c0 = &i2c1;",
		"        };",
		"",
		"        memory@40000000 {",
		'                device_type = "memory";',
		"                reg = <0x40000000 0x40000000>;",
		"        };",
		"",
		"        reserved-memory {",
		"                #address-cells = <0x2>;",
		"                #size-cells = <0x2>;",
		"                ranges;",
		"",
		"                framebuffer@90000000 {",
		"                        reg = <0x0 0x90000000 0x0 0x800000>;",
		"                        no-map;",
		"                };",
		"",
		"                rpmsg@0x400000 {",
		"                        reg = <0x0 0x400000 0x0 0x400000>;",
		"                };",
		"        };",
		"",
		"        soc@0 {",
		"                #address-cells = <0x1>;",
		"                #size-cells = <0x1>;",
		'                compatible = "simple-bus";',
		"                ranges;",
		"",
		"                uart3: serial@30890000 {",
		'                        compatible = "fsl,imx8mp-uart", "fsl,imx21-uart";',
		"                        reg = <0x30890000 0x1000>;",
		"                        interrupts = <0x0 0x37 0x4>;",
		"                        clocks = <0x2 0x19>;",
		'                        status = "okay";',
		"                };",
		"",
		"                i2c1: i2c@30a20000 {",
		'                        compatible = "fsl,imx8mp-i2c", "fsl,imx21-i2c";',
		"                        reg = <0x30a20000 0x10000>;",
		"                        interrupts = <0x0 0x24 0x4>;",
		"                        clocks = <0x2 0x7d>;",
		'                        status = "okay";',
		"",
		"                        temperature-sensor@48 {",
		'                                compatible = "ti,tmp102";',
		"                                reg = <0x48>;",
		'                                status = "okay";',
		"                        };",
		"",
		"                        touchscreen@4a {",
		'                                compatible = "edt,edt-ft5406";',
		"                                reg = <0x4a>;",
		"                                interrupt-parent = <0x2>;",
		"                                interrupts = <0x6a 0x1>;",
		"                                reset-gpios = <0x3 0x1f 0x1>;",
		'                                status = "okay";',
		"                        };",
		"                };",
		"",
		"                fec1: ethernet@30be0000 {",
		'                        compatible = "fsl,imx8mp-fec";',
		"                        reg = <0x30be0000 0x10000>;",
		"                        phy-handle = <0xa1>;",
		'                        phy-mode = "rgmii-id";',
		'                        status = "okay";',
		"                };",
		"",
		"                gpu@38000000 {",
		'                        compatible = "vivante,gc7000";',
		"                        reg = <0x38000000 0x40000>;",
		"                        interrupts = <0x0 0x94 0x4>;",
		'                        status = "okay";',
		"                };",
		"",
		"                ldb-display-controller {",
		"                        lvds-channel@0 {",
		"                                port@0 {",
		"                                        endpoint {",
		"                                                remote-endpoint = <0x85>;",
		"                                                phandle = <0x5f>;",
		"                                        };",
		"                                };",
		"",
		"                                port@1 {",
		"                                        endpoint {",
		"                                                remote-endpoint = <0x86>;",
		"                                                phandle = <0xa2>;",
		"                                        };",
		"                                };",
		"                        };",
		"                };",
	];

	const addI2cCluster = (busIndex: number) => {
		const busAddr = (0x30a40000 + busIndex * 0x10000).toString(16);
		const busLabel = `i2c${busIndex + 2}`;
		lines.push(
			`                ${busLabel}: i2c@${busAddr} {`,
			'                        compatible = "fsl,imx8mp-i2c", "fsl,imx21-i2c";',
			`                        reg = <0x${busAddr} 0x10000>;`,
			"                        interrupts = <0x0 0x24 0x4>;",
			"                        clocks = <0x2 0x7d>;",
			'                        status = "okay";',
		);

		for (let device = 0; device < 6; device += 1) {
			const address = 0x10 + busIndex * 0x10 + device;
			const addrHex = address.toString(16);
			lines.push(
				`                        sensor@${addrHex} {`,
				`                                compatible = \"nxp,s${busIndex}${device}18\";`,
				`                                reg = <0x${addrHex}>;`,
				'                                status = "okay";',
				"                        };",
			);
		}

		lines.push("                };");
	};

	for (let bus = 0; bus < 5; bus += 1) {
		addI2cCluster(bus);
	}

	const addSpiController = (index: number) => {
		const baseAddr = 0x30800000 + index * 0x10000;
		const addrHex = baseAddr.toString(16);
		lines.push(
			`                spi${index}: spi@${addrHex} {`,
			'                        compatible = "fsl,imx8mp-ecspi";',
			`                        reg = <0x${addrHex} 0x10000>;`,
			"                        #address-cells = <0x1>;",
			"                        #size-cells = <0x0>;",
			'                        status = "okay";',
		);

		for (let chip = 0; chip < 4; chip += 1) {
			const chipSelect = chip.toString(16);
			lines.push(
				`                        flash@${chipSelect} {`,
				'                                compatible = "jedec,spi-nor";',
				`                                reg = <0x${chipSelect}>;`,
				"                                spi-max-frequency = <0x1312d00>;",
				'                                status = "okay";',
				"                        };",
			);
		}

		lines.push("                };");
	};

	for (let spiIndex = 0; spiIndex < 4; spiIndex += 1) {
		addSpiController(spiIndex);
	}

	lines.push(
		"",
		"                audio@30000000 {",
		'                        compatible = "fsl,imx8mp-sai";',
		"                        reg = <0x30000000 0x10000>;",
		'                        status = "okay";',
		"",
		"                        codec@0 {",
		'                                compatible = "nxp,sgtl5000";',
		"                                reg = <0x0>;",
		'                                status = "okay";',
		"                        };",
		"                };",
		"",
		"                pcie@33800000 {",
		'                        compatible = "fsl,imx8mp-pcie";',
		"                        reg = <0x33800000 0x400000>;",
		'                        status = "okay";',
		"",
		"                        bridge@0 {",
		'                                compatible = "pci,pci-bridge";',
		"                                reg = <0x0 0x0 0x0 0x0>;",
		'                                status = "okay";',
		"",
		"                                endpoint@0,0 {",
		"                                        reg = <0x0 0x0 0x0 0x0>;",
		'                                        compatible = "pci14e4,165f";',
		"                                };",
		"",
		"                                endpoint@1,0 {",
		"                                        reg = <0x1 0x0 0x0 0x0>;",
		'                                        compatible = "pci8086,1539";',
		"                                };",
		"                        };",
		"                };",
	);

	lines.push("        };", "");

	lines.push(
		"        backlight: backlight@0 {",
		'                compatible = "pwm-backlight";',
		"                pwms = <0x7 0x0 0x3e8 0x0>;",
		"                brightness-levels = <0x0 0x1e 0x3c 0x64 0x96 0xc8 0xff>;",
		"                default-brightness-level = <0x3>;",
		'                status = "okay";',
		"        };",
		"",
		"        panel@0 {",
		'                compatible = "panel-lvds";',
		"                backlight = <0xa1>;",
		'                status = "okay";',
		"",
		"                port {",
		"                        panel_in: endpoint@0 {",
		"                                remote-endpoint = <0x5f>;",
		"                                phandle = <0x85>;",
		"                        };",
		"                };",
		"        };",
		"",
		"        usb@32f10108 {",
		'                compatible = "fsl,imx8mp-dwc3";',
		"                phandle = <0x83>;",
		"                clocks = <0x2 0x10c 0x2 0x140>;",
		'                clock-names = "hsio", "suspend";',
		"                interrupts = <0x0 0x95 0x4>;",
		"                ranges;",
		'                status = "okay";',
		"",
		"                usb@38200000 {",
		'                        compatible = "snps,dwc3";',
		"                        phys = <0x83 0x83>;",
		'                        phy-names = "usb2-phy", "usb3-phy";',
		'                        dr_mode = "host";',
		'                        status = "okay";',
		"                };",
		"        };",
		"",
		"        leds {",
		'                compatible = "gpio-leds";',
		"",
		"                status-led {",
		"                        gpios = <0x4 0x12 0x0>;",
		'                        default-state = "on";',
		"                };",
		"",
		"                heartbeat-led {",
		"                        gpios = <0x4 0x13 0x0>;",
		'                        linux,default-trigger = "heartbeat";',
		"                };",
		"        };",
		"",
		"        regulators {",
		'                compatible = "simple-bus";',
		"",
		"                buck@0 {",
		'                        regulator-name = "vdd_soc";',
		"                        regulator-min-microvolt = <0xf4240>;",
		"                        regulator-max-microvolt = <0x16e360>;",
		"                };",
		"",
		"                buck@1 {",
		'                        regulator-name = "vdd_gpu";',
		"                        regulator-min-microvolt = <0xf4240>;",
		"                        regulator-max-microvolt = <0x16e360>;",
		"                };",
		"        };",
		"",
		"        thermal-zones {",
		"                board {",
		"                        polling-delay-passive = <0x3e8>;",
		"                        polling-delay = <0x7d0>;",
		"",
		"                        trips {",
		"                                cpu-crit {",
		"                                        temperature = <0x1312d0>;",
		"                                        hysteresis = <0x64>;",
		'                                        type = "critical";',
		"                                };",
		"                        };",
		"                };",
		"        };",
		"",
		"        watchdog@30280000 {",
		'                compatible = "fsl,imx8mp-wdt";',
		"                reg = <0x30280000 0x10000>;",
		'                status = "okay";',
		"        };",
	);

	lines.push("};");

	return lines.join("\n");
})();

let currentLayout: LayoutResult | null = null;
let currentRoot: DtsNode | null = null;
let selectedNodePath: string | null = null;
let selectedNode: DtsNode | null = null;
let activeFilterRaw = "";
let activeFilterNormalized = "";
let activeStatusFilter: StatusFilter = "all";
let filteredLayout: LayoutResult | null = null;
let filteredNodes: LayoutNode[] = [];
let viewOffset = { x: 0, y: 0 };
let viewScale = 1;
const BASE_MIN_VIEW_SCALE = 0.05;
const BASE_MAX_VIEW_SCALE = Number.POSITIVE_INFINITY;
let minViewScale = BASE_MIN_VIEW_SCALE;
let maxViewScale = BASE_MAX_VIEW_SCALE;
let lastAutoFitScale: number | null = null;
let shouldAutoFitView = false;
const ZOOM_SENSITIVITY = 0.002;
let isPanning = false;
let panPointerId: number | null = null;
let panStart = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };

if (statusFilterSelect) {
	const defaultValue = statusFilterSelect.value;
	activeStatusFilter =
		defaultValue === "disabled"
			? "disabled"
			: defaultValue === "okay"
				? "okay"
				: "all";
}
let currentWarnings: string[] = [];
let lastStatus: {
	origin: string;
	nodeCount: number;
	errors: string[];
	warnings: string[];
} | null = null;
const nodeByPath = new Map<string, DtsNode>();
const nodeByLabel = new Map<string, DtsNode>();
const nodeByPhandle = new Map<number, DtsNode>();
// Paths of nodes considered "endpoints" – highlighted in the tree.
// This includes nodes literally named 'endpoint' and any nodes referenced via
// remote-endpoint / remote-endpoints properties (and the nodes containing those properties).
const endpointPaths = new Set<string>();
// Reference edges (phandle or label references) collected from properties.
let referenceEdges: ReferenceEdge[] = [];
const forcedVisiblePaths = new Set<string>();
const forcedVisibilityAnchors = new Map<string, string | null>();
const HANDLE_PROPERTY_NAMES = new Set([
	"phandle",
	"linux,phandle",
	"remote-endpoint",
	"remote-endpoints",
]);

const truncate = (value: string, max = 32): string => {
	if (value.length <= max) {
		return value;
	}
	return `${value.slice(0, max - 1)}…`;
};

const countNodes = (node: DtsNode): number =>
	1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);

const collectNumbersFromValue = (value: DtsValue): number[] => {
	const collected: number[] = [];
	const visit = (candidate: unknown) => {
		if (Array.isArray(candidate)) {
			candidate.forEach(visit);
			return;
		}
		if (typeof candidate === "number" && Number.isFinite(candidate)) {
			collected.push(candidate);
		}
	};

	visit(value as unknown);
	return collected;
};

const formatHandleNumber = (value: number): string =>
	value >= 10 ? `0x${value.toString(16)}` : String(value);

type PropertyReference = {
	target: DtsNode;
	display: string;
	kind: "phandle" | "label";
};

const collectPropertyReferences = (
	property: DtsProperty,
): PropertyReference[] => {
	const references: PropertyReference[] = [];
	const seen = new Set<string>();
	const nameLower = property.name.toLowerCase();
	const raw = property.raw ?? "";
	const containsExplicitLabel = /&[A-Za-z_][\w.-]*/.test(raw);
	const allowNumeric =
		HANDLE_PROPERTY_NAMES.has(nameLower) ||
		containsExplicitLabel ||
		property.type === "number" ||
		property.type === "mixed";

	const addReference = (
		target: DtsNode,
		display: string,
		kind: PropertyReference["kind"],
	) => {
		const key = `${target.path}|${kind}|${display}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		references.push({ target, display, kind });
	};

	const inspect = (candidate: unknown) => {
		if (Array.isArray(candidate)) {
			candidate.forEach(inspect);
			return;
		}

		if (candidate && typeof candidate === "object") {
			if (
				"ref" in candidate &&
				typeof (candidate as { ref?: unknown }).ref === "string"
			) {
				const label = String((candidate as { ref: string }).ref);
				const target = nodeByLabel.get(label);
				if (target) {
					addReference(target, `&${label}`, "label");
				}
			}
			return;
		}

		if (
			allowNumeric &&
			typeof candidate === "number" &&
			Number.isFinite(candidate)
		) {
			const target = nodeByPhandle.get(candidate);
			if (target) {
				addReference(target, formatHandleNumber(candidate), "phandle");
			}
		}
	};

	inspect(property.value as unknown);
	return references;
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

const getParentPath = (path: string): string | null => {
	if (!path || path === "/") {
		return null;
	}
	const trimmed =
		path.endsWith("/") && path !== "/" ? path.replace(/\/+$/, "") : path;
	const index = trimmed.lastIndexOf("/");
	if (index <= 0) {
		return "/";
	}
	const parent = trimmed.slice(0, index);
	return parent ? parent : "/";
};

const ensureForcedVisibility = (
	path: string,
	anchorPath?: string | null,
): boolean => {
	if (!nodeByPath.has(path)) {
		return false;
	}
	let changed = false;
	let current: string | null = path;
	while (current) {
		if (!forcedVisiblePaths.has(current)) {
			forcedVisiblePaths.add(current);
			changed = true;
		}
		if (!forcedVisibilityAnchors.has(current)) {
			forcedVisibilityAnchors.set(current, null);
		}
		if (current === path && anchorPath !== undefined) {
			const normalizedAnchor =
				anchorPath && anchorPath !== path ? anchorPath : null;
			if (forcedVisibilityAnchors.get(current) !== normalizedAnchor) {
				forcedVisibilityAnchors.set(current, normalizedAnchor);
				changed = true;
			}
		}
		if (current === "/") {
			break;
		}
		current = getParentPath(current);
	}
	return changed;
};

const rebuildNodeIndexes = (root: DtsNode | null) => {
	nodeByPath.clear();
	nodeByLabel.clear();
	nodeByPhandle.clear();
	endpointPaths.clear();
	referenceEdges = [];

	if (!root) {
		return;
	}

	// Collect all nodes for a second pass (needed so phandle references are fully populated)
	const allNodes: DtsNode[] = [];

	const visit = (node: DtsNode) => {
		nodeByPath.set(node.path, node);
		if (node.label) {
			nodeByLabel.set(node.label, node);
		}

		node.properties.forEach((property) => {
			if (
				property.name === "phandle" ||
				property.name === "linux,phandle"
			) {
				collectNumbersFromValue(property.value).forEach((handle) => {
					nodeByPhandle.set(handle, node);
				});
			}
		});

		node.children.forEach(visit);
		allNodes.push(node);
	};

	visit(root);

	const REMOTE_NAMES = new Set(["remote-endpoint", "remote-endpoints"]);
	const visitLabelRefs = (
		value: unknown,
		onLabel: (label: string) => void,
	) => {
		if (Array.isArray(value)) {
			value.forEach((entry) => visitLabelRefs(entry, onLabel));
			return;
		}
		if (value && typeof value === "object" && "ref" in value) {
			const label = (value as { ref?: unknown }).ref;
			if (typeof label === "string") {
				onLabel(label);
			}
		}
	};

	// Second pass: determine endpoint nodes.
	// Heuristics:
	// 1. Node whose fullName is exactly 'endpoint'.
	// 2. Nodes that declare remote-endpoint(s) properties.
	// 3. Targets referenced by those remote-endpoint(s) properties (via phandle numbers or labels).
	allNodes.forEach((node) => {
		if (node.fullName === "endpoint") {
			endpointPaths.add(node.path);
		}
		node.properties.forEach((prop) => {
			if (!REMOTE_NAMES.has(prop.name)) {
				return;
			}
			// Mark the node containing the property
			endpointPaths.add(node.path);
			collectNumbersFromValue(prop.value).forEach((handle) => {
				const target = nodeByPhandle.get(handle);
				if (target) {
					endpointPaths.add(target.path);
				}
			});
			visitLabelRefs(prop.value as unknown, (label) => {
				const target = nodeByLabel.get(label);
				if (target) {
					endpointPaths.add(target.path);
				}
			});
		});
	});

	// Build reference edges for any property that links via labels or phandles.
	const edgeDedup = new Set<string>();
	const undirectedSeen = new Set<string>();
	const tryAdd = (edge: ReferenceEdge) => {
		if (edge.source === edge.target) {
			return;
		}
		const undirectedKey =
			edge.source < edge.target
				? `${edge.source}|${edge.target}`
				: `${edge.target}|${edge.source}`;
		if (undirectedSeen.has(undirectedKey)) {
			return;
		}
		const key = `${edge.source}|${edge.target}|${edge.viaProperty}|${edge.kind}`;
		if (edgeDedup.has(key)) {
			return;
		}
		edgeDedup.add(key);
		undirectedSeen.add(undirectedKey);
		referenceEdges.push(edge);
	};

	allNodes.forEach((node) => {
		node.properties.forEach((prop) => {
			collectPropertyReferences(prop).forEach((ref) => {
				tryAdd({
					source: node.path,
					target: ref.target.path,
					viaProperty: prop.name,
					kind: ref.kind,
				});
			});
		});
	});
};

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

const findLayoutNodeByPath = (
	path: string,
	layout: LayoutResult | null,
): LayoutNode | null => {
	if (!layout) {
		return null;
	}
	return layout.nodes.find((node) => node.node.path === path) ?? null;
};

const pruneForcedVisibilityAnchors = () => {
	const stale: string[] = [];
	forcedVisibilityAnchors.forEach((_, path) => {
		if (!forcedVisiblePaths.has(path)) {
			stale.push(path);
		}
	});
	stale.forEach((path) => forcedVisibilityAnchors.delete(path));
};

const recomputeLayoutMetrics = (layout: LayoutResult) => {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;

	layout.nodes.forEach((node) => {
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

	layout.bounds = { minX, maxX, minY, maxY };
	layout.size = {
		width: Math.max(1, maxX - minX + CANVAS_PADDING * 2),
		height: Math.max(1, maxY - minY + CANVAS_PADDING * 2),
	};
	layout.offset = {
		x: CANVAS_PADDING - minX,
		y: CANVAS_PADDING - minY,
	};
};

const anchorForcedNodesNearSource = (
	layout: LayoutResult,
	anchors: Map<string, string | null>,
) => {
	if (!anchors.size) {
		return;
	}

	const nodesByPath = new Map<string, LayoutNode>();
	layout.nodes.forEach((node) => {
		nodesByPath.set(node.node.path, node);
	});

	const buckets = new Map<string, LayoutNode[]>();
	anchors.forEach((anchorPath, forcedPath) => {
		if (!anchorPath) {
			return;
		}
		const anchorNode = nodesByPath.get(anchorPath);
		const forcedNode = nodesByPath.get(forcedPath);
		if (!anchorNode || !forcedNode) {
			return;
		}
		const list = buckets.get(anchorPath);
		if (list) {
			list.push(forcedNode);
		} else {
			buckets.set(anchorPath, [forcedNode]);
		}
	});

	buckets.forEach((nodes, anchorPath) => {
		const anchorNode = nodesByPath.get(anchorPath);
		if (!anchorNode) {
			return;
		}
		const total = nodes.length;
		if (!total) {
			return;
		}
		const anchorCenterX = anchorNode.x + NODE_WIDTH / 2;
		const anchorCenterY = anchorNode.y;
		const spread = Math.PI / 1.5;
		const step = total === 1 ? 0 : spread / Math.max(total - 1, 1);
		const start = total === 1 ? 0 : -spread / 2;
		const radius = Math.max(NODE_WIDTH, NODE_HEIGHT) + NODE_GAP;
		nodes.forEach((node, index) => {
			const angleOffset = start + step * index;
			const targetCenterX =
				anchorCenterX + Math.cos(angleOffset) * radius;
			const targetCenterY =
				anchorCenterY + Math.sin(angleOffset) * radius;
			node.x = targetCenterX - NODE_WIDTH / 2;
			node.y = targetCenterY;
			node.portal = true;
			node.portalSourcePath = anchorNode.node.path;
			node.angle = Math.atan2(targetCenterY, targetCenterX);
			node.radius = Math.hypot(targetCenterX, targetCenterY);
			node.depth = Math.max(anchorNode.depth + 1, node.depth);
		});
	});

	recomputeLayoutMetrics(layout);
};

const getConnectedEndpointPaths = (path: string): string[] => {
	const results = new Set<string>();
	referenceEdges.forEach((edge) => {
		if (edge.source === path) {
			results.add(edge.target);
			return;
		}
		if (edge.target === path) {
			results.add(edge.source);
		}
	});
	results.delete(path);
	return [...results];
};

const focusNodeByPath = (path: string) => {
	const target = nodeByPath.get(path);
	if (!target) {
		return;
	}

	const hasActiveFilters =
		Boolean(activeFilterNormalized) || activeStatusFilter !== "all";
	if (hasActiveFilters) {
		const currentlyVisible =
			filteredLayout?.nodes.some((node) => node.node.path === path) ??
			false;
		if (!currentlyVisible) {
			const anchorPath =
				selectedNodePath && selectedNodePath !== path
					? selectedNodePath
					: null;
			ensureForcedVisibility(path, anchorPath);
			shouldAutoFitView = false;
			applyFilters();
		}
	}

	const layoutToUse = filteredLayout ?? currentLayout;
	if (!layoutToUse) {
		return;
	}

	let layoutNode = findLayoutNodeByPath(path, layoutToUse);
	if (!layoutNode && layoutToUse !== currentLayout) {
		layoutNode = findLayoutNodeByPath(path, currentLayout);
	}
	if (!layoutNode) {
		return;
	}

	selectLayoutNode(layoutNode);
};

type PropertyLink = PropertyReference;

const resolvePropertyLinks = (property: DtsProperty): PropertyLink[] =>
	collectPropertyReferences(property);

const registerMap: RegisterMapController = createRegisterMap({
        panel: registerMapPanel,
        toggle: registerMapToggle,
        status: registerMapStatus,
        track: registerMapTrack,
        legend: registerMapLegend,
        axis: registerMapAxis,
        onFocusNode: focusNodeByPath,
        collectNumbersFromValue,
});

const renderDetails = (node: DtsNode | null) => {
	if (!detailsContent || !detailsTitle) {
		return;
	}

        registerMap.setSelection(node?.path ?? null);

	detailsContent.innerHTML = "";

	if (!node) {
		detailsTitle.textContent = "Node details";
		const placeholder = document.createElement("p");
		placeholder.textContent =
			"Click any node in the tree to inspect its attributes and properties.";
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
		const links = resolvePropertyLinks(property).filter(
			(link) => link.target.path !== node.path,
		);
		if (links.length) {
			const linkList = document.createElement("div");
			linkList.className = "property-links";
			links.forEach((link) => {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "node-link";
				button.textContent = `${link.display} → ${link.target.fullName}`;
				button.title = `Jump to ${link.target.path}`;
				button.addEventListener("click", () => {
					focusNodeByPath(link.target.path);
				});
				linkList.append(button);
			});
			valueCell.append(linkList);
		}
		row.append(nameCell, typeCell, valueCell);
		tbody.append(row);
	});

	table.append(tbody);
	detailsContent.append(table);
};

const renderWarningsPanel = () => {
	if (!warningsPanel || !warningsToggle || !warningsToggleLabel) {
		return;
	}

	const hasWarnings = currentWarnings.length > 0;
	warningsToggle.disabled = !hasWarnings;
	warningsToggleLabel.classList.toggle("disabled", !hasWarnings);

	if (!hasWarnings) {
		warningsPanel.textContent = "";
		warningsPanel.classList.add("hidden");
		warningsToggle.checked = false;
		return;
	}

	const lines = currentWarnings.map((warning) => `• ${warning}`);
	warningsPanel.textContent = lines.join("\n");
	warningsPanel.classList.toggle("hidden", !warningsToggle.checked);
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
	currentWarnings = [...warnings];
	renderWarningsPanel();

	const lines: string[] = [
		`${origin} – ${nodeCount} node${nodeCount === 1 ? "" : "s"}`,
	];

	if (warnings.length) {
		statusElement.classList.add("warning");
		const descriptor = warningsToggle?.checked
			? `Warnings shown below (x${warnings.length})`
			: `Warnings hidden (x${warnings.length})`;
		lines.push(descriptor);
	}

	if (errors.length) {
		statusElement.classList.add("error");
		lines.push(`Errors (x${errors.length}):`);
		lines.push(...errors.map((e) => `• ${e}`));
	}

	statusElement.textContent = lines.join("\n");
	lastStatus = {
		origin,
		nodeCount,
		errors: [...errors],
		warnings: [...warnings],
	};
};

const buildLayout = (root: DtsNode): LayoutResult =>
	radialLayout(root, {
		referenceEdges,
		endpointPaths,
		nodeLookup: nodeByPath,
	});

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
};

const computeFitScale = (layout: LayoutResult) => {
	const wrapperWidth = viewerWrapper?.clientWidth ?? layout.size.width;
	const wrapperHeight = viewerWrapper?.clientHeight ?? layout.size.height;
	if (wrapperWidth <= 0 || wrapperHeight <= 0) {
		return 1;
	}
	const scaleX = wrapperWidth / layout.size.width;
	const scaleY = wrapperHeight / layout.size.height;
	const scale = Math.min(scaleX, scaleY);
	if (!Number.isFinite(scale) || scale <= 0) {
		return 1;
	}
	return scale;
};

const fitViewToLayout = (
	layout: LayoutResult,
	options: { preserveExistingTransform?: boolean } = {},
) => {
	const { preserveExistingTransform = false } = options;
	const previousAutoFit = lastAutoFitScale;
	const fitScale = computeFitScale(layout);
	minViewScale = fitScale;
	maxViewScale = Math.max(BASE_MAX_VIEW_SCALE, fitScale);
	lastAutoFitScale = fitScale;

	if (preserveExistingTransform) {
		const wasAtAutoFit =
			previousAutoFit !== null &&
			Math.abs(viewScale - previousAutoFit) < 1e-3 &&
			Math.abs(viewOffset.x) < 1e-3 &&
			Math.abs(viewOffset.y) < 1e-3;
		if (wasAtAutoFit) {
			viewScale = fitScale;
			viewOffset = { x: 0, y: 0 };
			return;
		}
		const clampedScale = clamp(viewScale, minViewScale, maxViewScale);
		if (Math.abs(clampedScale - viewScale) > 1e-6) {
			viewScale = clampedScale;
			viewOffset = { x: 0, y: 0 };
		}
		return;
	}

	viewScale = clamp(fitScale, minViewScale, maxViewScale);
	viewOffset = { x: 0, y: 0 };
};

const computeCanvasMetrics = (layout: LayoutResult, scale = viewScale) => {
	const scaledWidth = layout.size.width * scale;
	const scaledHeight = layout.size.height * scale;
	const wrapperWidth = viewerWrapper?.clientWidth ?? scaledWidth;
	const wrapperHeight = viewerWrapper?.clientHeight ?? scaledHeight;
	const width = Math.max(scaledWidth, wrapperWidth);
	const height = Math.max(scaledHeight, wrapperHeight);
	const extraX = Math.max(0, (width - scaledWidth) / 2);
	const extraY = Math.max(0, (height - scaledHeight) / 2);
	const baseTranslateX = layout.offset.x * scale + extraX;
	const baseTranslateY = layout.offset.y * scale + extraY;
	return {
		width,
		height,
		translateX: baseTranslateX + viewOffset.x,
		translateY: baseTranslateY + viewOffset.y,
		baseTranslateX,
		baseTranslateY,
		extraX,
		extraY,
	};
};

const requestFrame: (callback: FrameRequestCallback) => number =
        typeof requestAnimationFrame === "function"
                ? requestAnimationFrame
                : (callback) => setTimeout(() => callback(Date.now()), 16);

let scheduledLayout: LayoutResult | null = null;
let scheduledSelection: string | null = null;
let renderHandle: number | null = null;

const drawLayout = (layout: LayoutResult, selectedPath: string | null) => {
        if (!canvas || !ctx) {
                return;
        }

        const metrics = computeCanvasMetrics(layout);

	prepareCanvas(metrics.width, metrics.height);

	ctx.save();
	ctx.translate(metrics.translateX, metrics.translateY);
	ctx.scale(viewScale, viewScale);

	// Tree edges
	ctx.save();
	layout.nodes.forEach((node) => {
		const parentCenterX = node.x + NODE_WIDTH / 2;
		const parentCenterY = node.y;
		node.children.forEach((child) => {
			const childCenterX = child.x + NODE_WIDTH / 2;
			const childCenterY = child.y;
			ctx.beginPath();
			if (child.portal) {
				ctx.setLineDash([4, 6]);
				ctx.strokeStyle = "rgba(217, 119, 6, 0.45)";
				ctx.lineWidth = 1.3;
			} else {
				ctx.setLineDash([]);
				ctx.strokeStyle = "rgba(80, 80, 90, 0.55)";
				ctx.lineWidth = 1.4;
			}
			ctx.moveTo(parentCenterX, parentCenterY);
			ctx.lineTo(childCenterX, childCenterY);
			ctx.stroke();
		});
	});
	ctx.restore();

	// Reference edges (draw after tree edges, before nodes)
	ctx.save();
	const layoutNodesByPath = new Map<string, LayoutNode[]>();
	layout.nodes.forEach((ln) => {
		const list = layoutNodesByPath.get(ln.node.path);
		if (list) {
			list.push(ln);
		} else {
			layoutNodesByPath.set(ln.node.path, [ln]);
		}
	});

	const pickRepresentative = (nodes: LayoutNode[] | undefined) => {
		if (!nodes || nodes.length === 0) {
			return null;
		}
		return nodes.find((candidate) => !candidate.portal) ?? nodes[0] ?? null;
	};

	referenceEdges.forEach((edge) => {
		const sourceNode = pickRepresentative(
			layoutNodesByPath.get(edge.source),
		);
		const targetNode = pickRepresentative(
			layoutNodesByPath.get(edge.target),
		);
		if (!sourceNode || !targetNode) {
			return;
		}
		const fromX = sourceNode.x + NODE_WIDTH / 2;
		const fromY = sourceNode.y;
		const toX = targetNode.x + NODE_WIDTH / 2;
		const toY = targetNode.y;
		const midX = (fromX + toX) / 2;
		const midY = (fromY + toY) / 2;
		const offsetY = Math.abs(toX - fromX) < 1 ? 60 : 40;
		const ctrlX = midX;
		const ctrlY = midY - offsetY;
		const touchesSelection =
			selectedPath === edge.source || selectedPath === edge.target;
		ctx.beginPath();
		ctx.setLineDash(touchesSelection ? [5, 5] : [8, 6]);
		ctx.lineWidth = touchesSelection ? 1.8 : 1.2;
		ctx.strokeStyle =
			edge.kind === "label"
				? touchesSelection
					? "rgba(147, 51, 234, 0.9)"
					: "rgba(168, 85, 247, 0.45)"
				: touchesSelection
					? "rgba(2, 132, 199, 0.9)"
					: "rgba(14, 165, 233, 0.45)";
		ctx.moveTo(fromX, fromY);
		ctx.quadraticCurveTo(ctrlX, ctrlY, toX, toY);
		ctx.stroke();
	});
	ctx.restore();

	// Nodes
	ctx.save();
	ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";

        layout.nodes.forEach((node) => {
                const left = node.x;
                const top = node.y - NODE_HEIGHT / 2;
                const isSelected = selectedPath === node.node.path;
                const isEndpoint = endpointPaths.has(node.node.path);
		const isPortal = node.portal;

		if (isSelected) {
			ctx.setLineDash([]);
			ctx.fillStyle = "rgba(59, 130, 246, 0.92)";
			ctx.strokeStyle = "rgba(29, 78, 216, 0.95)";
			ctx.lineWidth = 2.2;
		} else if (isPortal && isEndpoint) {
			ctx.setLineDash([3, 3]);
			ctx.fillStyle = "rgba(252, 244, 214, 0.92)";
			ctx.strokeStyle = "rgba(217, 119, 6, 0.88)";
			ctx.lineWidth = 1.6;
		} else if (isPortal) {
			ctx.setLineDash([3, 3]);
			ctx.fillStyle = "rgba(254, 243, 199, 0.9)";
			ctx.strokeStyle = "rgba(217, 119, 6, 0.9)";
			ctx.lineWidth = 1.5;
		} else if (isEndpoint) {
			ctx.setLineDash([4, 3]);
			ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
			ctx.strokeStyle = "rgba(71, 85, 105, 0.9)";
			ctx.lineWidth = 1.4;
		} else {
			ctx.setLineDash([]);
			ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
			ctx.strokeStyle = "rgba(60, 60, 70, 0.8)";
			ctx.lineWidth = 1.2;
		}
		ctx.beginPath();
		ctx.roundRect(left, top, NODE_WIDTH, NODE_HEIGHT, 10);
		ctx.fill();
		ctx.stroke();
		ctx.setLineDash([]);

		const labelText = node.node.label
			? `${node.node.label}: ${node.node.fullName}`
			: node.node.fullName;
		const details: string[] = [
			`children: ${node.node.children.length}`,
			`props: ${node.node.properties.length}`,
		];
		if (isPortal) {
			details.push("portal");
		}
		if (isEndpoint) {
			details.push("endpoint");
		}
		const subtitle = details.join(" · ");

		ctx.fillStyle = isSelected
			? "#f8fafc"
			: isPortal
				? "#78350f"
				: isEndpoint
					? "#1f2937"
					: "#111827";
		ctx.fillText(truncate(labelText, 28), left + 12, node.y - 10);

		ctx.fillStyle = isSelected
			? "#e5e7eb"
			: isPortal
				? "#92400e"
				: isEndpoint
					? "#475569"
					: "#4b5563";
		ctx.fillText(truncate(subtitle, 32), left + 12, node.y + 10);
	});

	ctx.restore();
        ctx.restore();
};

const renderLayout = (layout: LayoutResult, selectedPath: string | null) => {
        scheduledLayout = layout;
        scheduledSelection = selectedPath;
        if (renderHandle !== null) {
                return;
        }
        renderHandle = requestFrame(() => {
                renderHandle = null;
                const layoutToRender = scheduledLayout;
                const selectionToRender = scheduledSelection;
                scheduledLayout = null;
                scheduledSelection = null;
                if (!layoutToRender) {
                        return;
                }
                drawLayout(layoutToRender, selectionToRender ?? null);
        });
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
		selectedNode = null;
		rebuildNodeIndexes(null);
                registerMap.updateRanges(null);
		renderDetails(null);
		return;
	}

	currentRoot = result.root;
	currentLayout = buildLayout(result.root);
	selectedNodePath = null;
	selectedNode = null;
	activeFilterRaw = "";
	activeFilterNormalized = "";
	rebuildNodeIndexes(currentRoot);
        registerMap.updateRanges(currentRoot);
	renderDetails(null);
	if (canvas) {
		canvas.style.cursor = "default";
	}
	filteredLayout = null;
	filteredNodes = [];
	forcedVisiblePaths.clear();
	forcedVisibilityAnchors.clear();
	if (searchInput) {
		searchInput.value = "";
	}
	viewOffset = { x: 0, y: 0 };
	viewScale = 1;
	minViewScale = BASE_MIN_VIEW_SCALE;
	maxViewScale = BASE_MAX_VIEW_SCALE;
	lastAutoFitScale = null;
	shouldAutoFitView = true;
	applyFilters();
};

const getLogicalPoint = (event: MouseEvent) => {
	if (!canvas) {
		return null;
	}
	const layout = filteredLayout ?? currentLayout;
	if (!layout) {
		return null;
	}
	const metrics = computeCanvasMetrics(layout);
	const rect = canvas.getBoundingClientRect();
	const x = (event.clientX - rect.left - metrics.translateX) / viewScale;
	const y = (event.clientY - rect.top - metrics.translateY) / viewScale;
	return { x, y };
};

const pickNodeAt = (x: number, y: number): LayoutNode | null => {
	const layout = filteredLayout ?? currentLayout;
	if (!layout) {
		return null;
	}
	return (
		layout.nodes.find(
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
	return pickNodeAt(point.x, point.y);
};

const selectLayoutNode = (layoutNode: LayoutNode) => {
	selectedNodePath = layoutNode.node.path;
	selectedNode = nodeByPath.get(selectedNodePath) ?? layoutNode.node;
	renderDetails(selectedNode);
	let shouldReapplyFilters = false;
	if (filteredLayout && endpointPaths.has(layoutNode.node.path)) {
		const connected = getConnectedEndpointPaths(layoutNode.node.path);
		connected.forEach((path) => {
			if (!filteredNodes.some((entry) => entry.node.path === path)) {
				if (ensureForcedVisibility(path)) {
					shouldReapplyFilters = true;
				}
			}
		});
	}
	if (shouldReapplyFilters) {
		shouldAutoFitView = true;
		applyFilters();
		return;
	}
	const layoutForSelection = filteredLayout ?? currentLayout;
	if (layoutForSelection) {
		renderLayout(layoutForSelection, selectedNodePath);
	}
};

const updateSearchSummary = (
	query: string,
	matchCount: number,
	statusFilter: StatusFilter,
) => {
	if (!searchSummary) {
		return;
	}
	const hasQuery = Boolean(query);
	const hasStatusFilter = statusFilter !== "all";
	if (!hasQuery && !hasStatusFilter) {
		searchSummary.textContent = "";
		return;
	}

	if (matchCount === 0) {
		if (hasQuery && hasStatusFilter) {
			searchSummary.textContent = `No matches for "${query}" (status: ${statusFilter})`;
			return;
		}
		if (hasQuery) {
			searchSummary.textContent = `No matches for "${query}"`;
			return;
		}
		searchSummary.textContent = `No nodes with status ${statusFilter}`;
		return;
	}

	const segments: string[] = [];
	if (hasQuery) {
		const suffix = matchCount === 1 ? "match" : "matches";
		segments.push(`${matchCount} ${suffix} for "${query}"`);
	} else {
		const suffix = matchCount === 1 ? "node" : "nodes";
		segments.push(`${matchCount} ${suffix}`);
	}
	if (hasStatusFilter) {
		segments.push(`status: ${statusFilter}`);
	}
	searchSummary.textContent = segments.join(" · ");
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
		...node.properties.flatMap((prop) => [
			prop.name,
			formatValue(prop.value),
		]),
	];
	return haystacks.some((text) => text.toLowerCase().includes(normalized));
};

const extractStatusString = (value: unknown): string | null => {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			const candidate = extractStatusString(entry);
			if (candidate) {
				return candidate;
			}
		}
		return null;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return null;
};

const getNodeStatus = (node: DtsNode): string | null => {
	const property = node.properties.find((prop) => prop.name === "status");
	if (!property) {
		return null;
	}
	const extracted = extractStatusString(property.value as unknown);
	return extracted ? extracted.toLowerCase().trim() : null;
};

const nodeMatchesStatus = (node: DtsNode, filter: StatusFilter): boolean => {
	if (filter === "all") {
		return true;
	}
	const status = getNodeStatus(node);
	if (filter === "disabled") {
		return (
			status === "disabled" || status === "disable" || status === "off"
		);
	}
	// Treat missing status as effectively "okay"
	if (status === null) {
		return true;
	}
	return status === "okay" || status === "ok" || status === "enabled";
};

const filterDtsTree = (
	node: DtsNode,
	normalized: string,
	statusFilter: StatusFilter,
	forced: Set<string>,
): DtsNode | null => {
	const filteredChildren = node.children
		.map((child) => filterDtsTree(child, normalized, statusFilter, forced))
		.filter((child): child is DtsNode => child !== null);

	const matchesStatus = nodeMatchesStatus(node, statusFilter);
	const matchesSearch = normalized
		? nodeMatchesNormalized(node, normalized)
		: true;
	const isForced = forced.has(node.path);
	const matchesSelf = matchesStatus && matchesSearch;
	const shouldKeep = matchesSelf || isForced || filteredChildren.length > 0;

	if (!shouldKeep) {
		return null;
	}

	const unchangedChildren =
		filteredChildren.length === node.children.length &&
		filteredChildren.every(
			(child, index) => child === node.children[index],
		);

	if ((matchesSelf || isForced) && unchangedChildren) {
		return node;
	}

	return {
		...node,
		children: filteredChildren,
	};
};

type FilteredView = {
        root: DtsNode;
        layout: LayoutResult;
};

const buildFilteredView = (
        root: DtsNode | null,
        normalized: string,
        statusFilter: StatusFilter,
        forced: Set<string>,
        anchors: Map<string, string | null>,
): FilteredView | null => {
        if (!root) {
                return null;
        }
        if (!normalized && statusFilter === "all") {
                return null;
        }

        const filteredRoot = filterDtsTree(root, normalized, statusFilter, forced);
        if (!filteredRoot) {
                return null;
        }

        const layout = buildLayout(filteredRoot);
        anchorForcedNodesNearSource(layout, anchors);
        return { root: filteredRoot, layout };
};

const applyFilters = () => {
        const normalized = activeFilterNormalized;
        const statusFilter = activeStatusFilter;
        const hasActiveFilters = Boolean(normalized) || statusFilter !== "all";
        if (!hasActiveFilters) {
                forcedVisiblePaths.clear();
                forcedVisibilityAnchors.clear();
        } else {
                pruneForcedVisibilityAnchors();
        }
        const filteredView = buildFilteredView(
                currentRoot,
                normalized,
                statusFilter,
                forcedVisiblePaths,
                forcedVisibilityAnchors,
        );
        filteredLayout = filteredView?.layout ?? null;
        filteredNodes = filteredLayout?.nodes ?? [];

        const registerMapRoot = filteredView
                ? filteredView.root
                : hasActiveFilters
                ? null
                : currentRoot;
        registerMap.updateRanges(registerMapRoot);

        if (hasActiveFilters) {
                const currentNodes = filteredNodes;
                const existingSelection =
                        selectedNodePath &&
			currentNodes.find((node) => node.node.path === selectedNodePath);

		if (!existingSelection) {
			if (currentNodes.length > 0) {
				const firstMatch =
					(activeFilterNormalized
						? currentNodes.find((node) =>
								nodeMatchesNormalized(
									node.node,
									activeFilterNormalized,
								),
							)
						: undefined) ?? currentNodes[0]!;
				selectedNodePath = firstMatch.node.path;
				selectedNode =
					nodeByPath.get(selectedNodePath) ?? firstMatch.node;
				renderDetails(selectedNode);
			} else {
				selectedNodePath = null;
				selectedNode = null;
				renderDetails(null);
			}
		} else if (selectedNodePath) {
			selectedNode =
				nodeByPath.get(selectedNodePath) ??
				existingSelection?.node ??
				null;
			renderDetails(selectedNode);
		}
	} else {
		if (selectedNodePath) {
			const baseNode = currentLayout?.nodes.find(
				(node) => node.node.path === selectedNodePath,
			);
			if (!baseNode) {
				selectedNodePath = null;
				selectedNode = null;
				renderDetails(null);
			} else {
				selectedNode =
					nodeByPath.get(selectedNodePath) ?? baseNode.node;
				renderDetails(selectedNode);
			}
		} else if (!selectedNode) {
			renderDetails(null);
		}
	}

	const layoutForFilters =
		filteredLayout ?? (hasActiveFilters ? null : currentLayout);
	if (layoutForFilters) {
		if (shouldAutoFitView) {
			fitViewToLayout(layoutForFilters);
			shouldAutoFitView = false;
		} else {
			fitViewToLayout(layoutForFilters, {
				preserveExistingTransform: true,
			});
		}
		renderLayout(layoutForFilters, selectedNodePath);
	} else if (canvas && ctx) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		minViewScale = BASE_MIN_VIEW_SCALE;
		maxViewScale = BASE_MAX_VIEW_SCALE;
		lastAutoFitScale = null;
		viewOffset = { x: 0, y: 0 };
		shouldAutoFitView = false;
	}

	const summaryCount = filteredLayout ? filteredNodes.length : 0;
	updateSearchSummary(
		activeFilterRaw.trim(),
		summaryCount,
		activeStatusFilter,
	);
};

const applySearch = (query: string) => {
	const normalized = normalizeFilter(query);
	const changed =
		normalized !== activeFilterNormalized || query !== activeFilterRaw;
	if (changed) {
		forcedVisiblePaths.clear();
		forcedVisibilityAnchors.clear();
		shouldAutoFitView = true;
	}
	activeFilterRaw = query;
	activeFilterNormalized = normalized;
	applyFilters();
};

const clearSearch = () => {
	activeFilterRaw = "";
	activeFilterNormalized = "";
	forcedVisiblePaths.clear();
	forcedVisibilityAnchors.clear();
	if (searchInput) {
		searchInput.value = "";
	}
	shouldAutoFitView = true;
	applyFilters();
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

        warningsToggle?.addEventListener("change", () => {
                renderWarningsPanel();
                if (lastStatus) {
                        updateStatus(
                                lastStatus.origin,
				lastStatus.nodeCount,
				lastStatus.errors,
				lastStatus.warnings,
			);
		}
	});

	statusFilterSelect?.addEventListener("change", () => {
		const value = statusFilterSelect.value;
		activeStatusFilter =
			value === "disabled"
				? "disabled"
				: value === "okay"
					? "okay"
					: "all";
		forcedVisiblePaths.clear();
		forcedVisibilityAnchors.clear();
		shouldAutoFitView = true;
		applyFilters();
	});

	if (canvas) {
		const endPan = () => {
			if (!isPanning) {
				return;
			}
			isPanning = false;
			if (panPointerId !== null) {
				try {
					canvas.releasePointerCapture(panPointerId);
				} catch (error) {
					// Ignore if capture was not set
				}
			}
			panPointerId = null;
			canvas.style.cursor = "default";
		};

		canvas.addEventListener(
			"wheel",
			(event) => {
				const layout = filteredLayout ?? currentLayout;
				if (!layout) {
					return;
				}

				if (event.ctrlKey) {
					event.preventDefault();
					if (isPanning) {
						endPan();
					}
					const rect = canvas.getBoundingClientRect();
					const pointerX = event.clientX - rect.left;
					const pointerY = event.clientY - rect.top;
					const metrics = computeCanvasMetrics(layout);
					const worldX = (pointerX - metrics.translateX) / viewScale;
					const worldY = (pointerY - metrics.translateY) / viewScale;
					const zoomFactor = Math.exp(
						-event.deltaY * ZOOM_SENSITIVITY,
					);
					const nextScale = clamp(
						viewScale * zoomFactor,
						minViewScale,
						maxViewScale,
					);
					if (nextScale === viewScale) {
						return;
					}
					const nextMetrics = computeCanvasMetrics(layout, nextScale);
					const newTranslateX = pointerX - worldX * nextScale;
					const newTranslateY = pointerY - worldY * nextScale;
					viewOffset = {
						x: newTranslateX - nextMetrics.baseTranslateX,
						y: newTranslateY - nextMetrics.baseTranslateY,
					};
					viewScale = nextScale;
					shouldAutoFitView = false;
					renderLayout(layout, selectedNodePath);
					return;
				}

				event.preventDefault();
				if (isPanning) {
					endPan();
				}
				const deltaMode = event.deltaMode;
				const deltaUnit =
					deltaMode === 1
						? 16
						: deltaMode === 2
							? canvas.clientHeight ||
								viewerWrapper?.clientHeight ||
								400
							: 1;
				const panX = event.deltaX * deltaUnit;
				const panY = event.deltaY * deltaUnit;
				if (Math.abs(panX) < 1e-3 && Math.abs(panY) < 1e-3) {
					return;
				}
				viewOffset = {
					x: viewOffset.x - panX,
					y: viewOffset.y - panY,
				};
				shouldAutoFitView = false;
				renderLayout(layout, selectedNodePath);
			},
			{ passive: false },
		);

		canvas.addEventListener("pointerdown", (event) => {
			if (event.button !== 1) {
				return;
			}
			event.preventDefault();
			isPanning = true;
			panPointerId = event.pointerId;
			panStart = { x: event.clientX, y: event.clientY };
			panOrigin = { ...viewOffset };
			try {
				canvas.setPointerCapture(event.pointerId);
			} catch (error) {
				// Ignore if unsupported
			}
			canvas.style.cursor = "grabbing";
		});

		canvas.addEventListener("pointermove", (event) => {
			if (!isPanning || panPointerId !== event.pointerId) {
				return;
			}
			event.preventDefault();
			const deltaX = event.clientX - panStart.x;
			const deltaY = event.clientY - panStart.y;
			viewOffset = {
				x: panOrigin.x + deltaX,
				y: panOrigin.y + deltaY,
			};
			const activeLayout = filteredLayout ?? currentLayout;
			if (activeLayout) {
				renderLayout(activeLayout, selectedNodePath);
			}
		});

		canvas.addEventListener("pointerup", (event) => {
			if (event.pointerId !== panPointerId) {
				return;
			}
			event.preventDefault();
			endPan();
		});

		canvas.addEventListener("pointercancel", (event) => {
			if (event.pointerId !== panPointerId) {
				return;
			}
			endPan();
		});

		canvas.addEventListener("click", (event) => {
			const hit = pickNodeFromEvent(event);
			if (hit) {
				selectLayoutNode(hit);
			}
		});

		canvas.addEventListener("mousemove", (event) => {
			if (isPanning) {
				return;
			}
			const hit = pickNodeFromEvent(event);
			if (!canvas) {
				return;
			}
			canvas.style.cursor = hit ? "pointer" : "default";
		});

		canvas.addEventListener("mouseleave", () => {
			endPan();
			if (canvas) {
				canvas.style.cursor = "default";
			}
		});
	}

	searchForm?.addEventListener("submit", (event) => {
		event.preventDefault();
		applySearch(searchInput?.value ?? "");
	});

	searchInput?.addEventListener("input", () => {
		applySearch(searchInput.value);
	});

	searchClear?.addEventListener("click", () => {
		clearSearch();
	});

	window.addEventListener("resize", () => {
		const layout = filteredLayout ?? currentLayout;
		if (!layout) {
			return;
		}
		fitViewToLayout(layout, { preserveExistingTransform: true });
		renderLayout(layout, selectedNodePath);
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

registerMap.setExpanded(false);

if (!ctx) {
        statusElement?.classList.add("error");
        statusElement?.append(
                "\nCanvas rendering context unavailable in this browser.",
        );
} else {
        attachEventHandlers();
}
